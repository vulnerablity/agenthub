# services/document_worker.py
# 文档异步处理 worker（knowledge.md 3.4）：进程内 asyncio 队列 + 信号量并发，单 Worker/单副本部署前提（D4）
# 状态机 pending → processing → completed / failed：
#   - 启动时把 pending/processing 文档重置为 pending 重新入队（重启恢复）
#   - 每次处理先幂等清理该文档旧 chunks 与向量点（双写一致性，二轮评审 P1）
#   - 写库/写向量前二次确认 document / KB 仍存在（删除竞态防御，D9）
#   - 任一环节异常 → 清理该文档向量点 → status=failed + error_message（不阻塞其它文档）
import asyncio
from datetime import UTC, datetime
from typing import ClassVar
from uuid import uuid4

from app.core.config import settings
from app.core.exceptions import AppError, VectorStoreError
from app.db.session import async_session_factory
from app.integrations.embedding import get_embedding_client
from app.integrations.parsers import chunk_pages, estimate_tokens, extract_pages
from app.integrations.vector_store import (
    PAYLOAD_CHUNK_INDEX,
    PAYLOAD_DOCUMENT_ID,
    PAYLOAD_KB_ID,
    PAYLOAD_PAGE_END,
    PAYLOAD_PAGE_START,
    PAYLOAD_VECTOR_ID,
    get_vector_store,
)
from app.models import DocumentChunk
from app.repositories.knowledge_repo import KnowledgeRepository


def _read_file(path: str) -> bytes:
    with open(path, "rb") as handle:
        return handle.read()


class DocumentWorker:
    """进程内文档处理 worker（单例）；测试经 start/stop 管理生命周期"""

    _instance: ClassVar["DocumentWorker | None"] = None

    def __init__(self) -> None:
        self._queue: asyncio.Queue[int] = asyncio.Queue()
        self._semaphore = asyncio.Semaphore(settings.WORKER_CONCURRENCY)
        self._consumer_task: asyncio.Task | None = None
        self._inflight: set[asyncio.Task] = set()

    @classmethod
    def get_worker(cls) -> "DocumentWorker":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def enqueue(self, document_id: int) -> None:
        """上传接口入队（非阻塞）"""
        self._queue.put_nowait(document_id)

    async def start(self) -> None:
        """启动：恢复中断任务 + 拉起消费循环（幂等，app lifespan 与测试共用）"""
        if self._consumer_task is None or self._consumer_task.done():
            await self._recover()
            self._consumer_task = asyncio.create_task(self._consumer())

    async def stop(self) -> None:
        """停止：取消消费循环与在途任务（测试隔离用；运行态请求会 409 由上传方兜底）"""
        task = self._consumer_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        for inflight in list(self._inflight):
            inflight.cancel()
        self._inflight.clear()
        self._consumer_task = None

    # ---------- 内部 ----------

    async def _recover(self) -> None:
        """重启恢复：pending/processing 一律重置为 pending 并重新入队（幂等重跑会先清旧数据）"""
        async with async_session_factory() as db:
            docs = await KnowledgeRepository(db).list_recoverable()
            for doc in docs:
                doc.status = "pending"
                doc.processing_started_at = None
            await db.commit()
        for doc in docs:
            self.enqueue(doc.id)

    async def _consumer(self) -> None:
        while True:
            document_id = await self._queue.get()
            task = asyncio.create_task(self._run_with_semaphore(document_id))
            self._inflight.add(task)
            task.add_done_callback(self._inflight.discard)

    async def _run_with_semaphore(self, document_id: int) -> None:
        async with self._semaphore:
            await self._process(document_id)

    async def _process(self, document_id: int) -> None:
        # 前置：二次确认 + 置 processing + 幂等清理旧数据（chunks 行与向量点）
        prepared = await self._prepare(document_id)
        if not prepared:
            return  # 文档/KB 已不存在（删除竞态防御），静默退出
        try:
            await asyncio.wait_for(
                self._run_pipeline(document_id),
                timeout=settings.DOCUMENT_PROCESSING_TIMEOUT,
            )
        except asyncio.TimeoutError:
            await self._fail(document_id, "文档处理超时")
        except (AppError, VectorStoreError) as exc:
            await self._fail(document_id, exc.message)
        except Exception as exc:  # noqa: BLE001 — worker 兜底：任何异常转 failed 不中断消费循环
            await self._fail(document_id, f"处理失败：{exc}")

    async def _prepare(self, document_id: int) -> bool:
        async with async_session_factory() as db:
            repo = KnowledgeRepository(db)
            doc = await repo.get_document(document_id)
            if doc is None:
                return False
            kb = await repo.get_kb(doc.knowledge_base_id)
            if kb is None:
                return False
            # 幂等重跑准备（重启恢复 / 失败重试共用，双写一致性）
            await repo.delete_chunks_by_document(doc.id)
            doc.status = "processing"
            doc.processing_started_at = datetime.now(UTC)
            doc.error_message = None
            await db.commit()
        try:
            await get_vector_store().delete_document(doc.id)
        except VectorStoreError:
            pass  # 清理属最佳努力；后续 upsert 失败会走 _fail 再次清理
        return True

    async def _run_pipeline(self, document_id: int) -> None:
        """解析 → 切块 → 批量 Embedding（KB 落库模型，D2）→ upsert → 写 chunks → completed"""
        async with async_session_factory() as db:
            repo = KnowledgeRepository(db)
            doc = await repo.get_document(document_id)
            if doc is None:
                return
            kb = await repo.get_kb(doc.knowledge_base_id)
            if kb is None:
                return
            data = await asyncio.to_thread(_read_file, doc.storage_path)
            pages = await asyncio.to_thread(extract_pages, doc.file_type, data)
            drafts = chunk_pages(pages, kb.chunk_size, kb.chunk_overlap)
            if not drafts:
                raise ValueError("未切分出有效文本块")

            texts = [draft.content for draft in drafts]
            vectors: list[list[float]] = []
            client = get_embedding_client()
            for start in range(0, len(texts), settings.EMBEDDING_BATCH_SIZE):
                batch = texts[start : start + settings.EMBEDDING_BATCH_SIZE]
                vectors.extend(await client.embed(batch, kb.embedding_model))

            points = []
            rows: list[DocumentChunk] = []
            for chunk_index, (draft, vector) in enumerate(zip(drafts, vectors)):
                vector_id = uuid4().hex
                points.append(
                    (
                        vector_id,
                        vector,
                        {
                            PAYLOAD_KB_ID: kb.id,
                            PAYLOAD_DOCUMENT_ID: doc.id,
                            PAYLOAD_CHUNK_INDEX: chunk_index,
                            PAYLOAD_VECTOR_ID: vector_id,
                            PAYLOAD_PAGE_START: draft.page_start,
                            PAYLOAD_PAGE_END: draft.page_end,
                        },
                    )
                )
                rows.append(
                    DocumentChunk(
                        document_id=doc.id,
                        content=draft.content,
                        chunk_index=chunk_index,
                        token_count=estimate_tokens(draft.content),
                        metadata_json={
                            "page_start": draft.page_start,
                            "page_end": draft.page_end,
                        },
                        vector_id=vector_id,
                    )
                )

            await get_vector_store().upsert(points)
            # upsert 后二次确认（D9）：文档需仍存在才落库 chunks，否则清理点并退出
            current = await repo.get_document(document_id)
            if current is None:
                await get_vector_store().delete_document(document_id)
                return
            db.add_all(rows)
            current.status = "completed"
            current.chunk_count = len(rows)
            current.processing_started_at = None
            await db.commit()

    async def _fail(self, document_id: int, message: str) -> None:
        """统一失败路径：清理该文档向量点（双写一致性）+ status=failed + error_message"""
        try:
            await get_vector_store().delete_document(document_id)
        except VectorStoreError:
            pass
        async with async_session_factory() as db:
            doc = await KnowledgeRepository(db).get_document(document_id)
            if doc is None:
                return
            doc.status = "failed"
            doc.error_message = (message or "处理失败")[:1000]
            doc.processing_started_at = None
            await db.commit()


def get_worker() -> DocumentWorker:
    return DocumentWorker.get_worker()