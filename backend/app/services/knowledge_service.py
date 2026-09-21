# services/knowledge_service.py
# 知识库业务编排（组织存在/成员身份/角色兜底在 api/deps.require_header_org_role；
# 知识库归属（kb.organization_id == org.id）为本模块数据隔离的第二道闸，跨组织一律 404）
# 删除语义（knowledge.md D9）：先校验无 processing → 删本地文件（尽力）→ 删向量点（按 filter，尽力）
# → 级联删 DB；Qdrant 故障不阻断删除（残留点已随 kb/document filter 不可达）
import asyncio
from pathlib import Path
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    DocumentNotFound,
    DocumentProcessing,
    FileEmpty,
    FileTooLarge,
    FileTypeNotSupported,
    KnowledgeBaseFieldRequired,
    KnowledgeBaseNameConflict,
    KnowledgeBaseNotFound,
    KnowledgeBaseProcessing,
    VectorStoreError,
)
from app.integrations.embedding import get_embedding_client
from app.integrations.parsers import SUPPORTED_TYPES
from app.integrations.vector_store import (
    PAYLOAD_DOCUMENT_ID,
    PAYLOAD_PAGE_START,
    PAYLOAD_VECTOR_ID,
    get_vector_store,
)
from app.models import Document, KnowledgeBase, Organization
from app.repositories.knowledge_repo import KnowledgeRepository
from app.schemas.knowledge import (
    DocumentListItem,
    DocumentStatusDetail,
    KnowledgeBaseCreateRequest,
    KnowledgeBaseDetail,
    KnowledgeBaseUpdateRequest,
    SearchRequest,
    SearchResponse,
    SearchResultItem,
)
from app.services import document_worker


class KnowledgeService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = KnowledgeRepository(db)

    # ---------- 知识库 CRUD ----------

    async def create_kb(
        self, org: Organization, data: KnowledgeBaseCreateRequest
    ) -> KnowledgeBaseDetail:
        """创建知识库：embedding_model 落库启动期全局值（D2），chunk 参数仅创建时配置（D7）"""
        if await self.repo.name_exists(org.id, data.name):
            raise KnowledgeBaseNameConflict()
        kb = await self.repo.create_kb(
            KnowledgeBase(
                organization_id=org.id,
                name=data.name,
                description=data.description,
                embedding_model=settings.EMBEDDING_MODEL,
                chunk_size=data.chunk_size,
                chunk_overlap=data.chunk_overlap,
            )
        )
        try:
            await self.db.commit()
            await self.db.refresh(kb)
        except IntegrityError as exc:
            await self.db.rollback()
            raise KnowledgeBaseNameConflict() from exc
        return self._kb_detail(kb, 0, 0)

    async def list_kbs(self, org: Organization) -> list[KnowledgeBaseDetail]:
        rows = await self.repo.list_kb_with_counts(org.id)
        return [
            self._kb_detail(kb, count, processing)
            for kb, count, processing in rows
        ]

    async def get_kb(self, org: Organization, kb_id: int) -> KnowledgeBaseDetail:
        row = await self.repo.kb_with_counts(org.id, kb_id)
        if row is None:
            raise KnowledgeBaseNotFound()
        kb, count, processing = row
        return self._kb_detail(kb, count, processing)

    async def update_kb(
        self, org: Organization, kb_id: int, data: KnowledgeBaseUpdateRequest
    ) -> KnowledgeBaseDetail:
        """更新名称/描述；chunk 参数新建后不可改（D7）"""
        kb = await self._get_in_org(org, kb_id)
        values = data.model_dump(exclude_unset=True)
        if "name" in values:
            if not values["name"] or not values["name"].strip():
                raise KnowledgeBaseFieldRequired("知识库名称")
            if values["name"] != kb.name and await self.repo.name_exists(
                org.id, values["name"]
            ):
                raise KnowledgeBaseNameConflict()
        for key, value in values.items():
            setattr(kb, key, value)
        await self.db.commit()
        # updated_at 带 onupdate，UPDATE 后过期属性需 refresh 取回（async 下不能依赖懒加载）
        await self.db.refresh(kb)
        return await self.get_kb(org, kb_id)

    async def delete_kb(self, org: Organization, kb_id: int) -> None:
        """删除知识库：含 processing 文档 → 409（D9）；否则顺序清理文件/向量/DB"""
        kb = await self._get_in_org(org, kb_id)
        if await self.repo.has_processing(kb.id):
            raise KnowledgeBaseProcessing()
        self._remove_dir(self._kb_dir(kb.id))
        try:
            await get_vector_store().delete_kb(kb.id)
        except VectorStoreError:
            pass  # Qdrant 故障不阻断删除（knowledge.md 3.3 备注）
        await self.repo.delete_kb(kb)
        await self.db.commit()

    async def delete_by_org(self, org_id: int) -> None:
        """解散组织前清理其全部知识库（文件 + 向量尽力清理 + DB 级联，organization_service.dissolve 联动）"""
        for kb_id in await self.repo.kb_ids_by_org(org_id):
            self._remove_dir(self._kb_dir(kb_id))
            try:
                await get_vector_store().delete_kb(kb_id)
            except VectorStoreError:
                pass
        await self.repo.delete_kb_by_org(org_id)

    # ---------- 文档 ----------

    async def upload_document(
        self, org: Organization, kb_id: int, filename: str, content: bytes
    ) -> DocumentListItem:
        """上传文档：校验 → 存文件 → 建 pending 文档 → 入队（D4/D6）"""
        kb = await self._get_in_org(org, kb_id)
        file_type = self._validate_file(filename, content)
        storage_path = self._kb_dir(kb.id) / f"{uuid4().hex}.{file_type}"
        await asyncio.to_thread(self._write_file, storage_path, content)
        doc = await self.repo.create_document(
            Document(
                knowledge_base_id=kb.id,
                filename=filename[:255],
                file_type=file_type,
                file_size=len(content),
                storage_path=str(storage_path),
            )
        )
        await self.db.commit()
        await self.db.refresh(doc)
        document_worker.get_worker().enqueue(doc.id)
        return self._document_item(doc)

    async def list_kb_documents(
        self, org: Organization, kb_id: int
    ) -> list[DocumentListItem]:
        await self._get_in_org(org, kb_id)
        docs = await self.repo.list_documents(kb_id)
        return [self._document_item(doc) for doc in docs]

    async def delete_document(self, org: Organization, document_id: int) -> None:
        """删除文档：processing → 409；否则删文件（尽力）+ 删向量点（尽力）+ 级联 DB（D9）"""
        doc = await self._get_document_in_org(org, document_id)
        if doc.status == "processing":
            raise DocumentProcessing()
        self._remove_file(Path(doc.storage_path))
        try:
            await get_vector_store().delete_document(doc.id)
        except VectorStoreError:
            pass
        await self.repo.delete_document(doc)
        await self.db.commit()

    async def get_document_status(
        self, org: Organization, document_id: int
    ) -> DocumentStatusDetail:
        doc = await self._get_document_in_org(org, document_id)
        return DocumentStatusDetail(
            id=doc.id,
            filename=doc.filename,
            status=doc.status,
            error_message=doc.error_message,
            chunk_count=doc.chunk_count,
        )

    # ---------- RAG 检索 ----------

    async def search(
        self, org: Organization, kb_id: int, data: SearchRequest
    ) -> SearchResponse:
        """RAG 检索（需求 3.6）：Service 校验 KB 归属后，才以 kb_id 打向量库（Qdrant 不承载租户权限）"""
        kb = await self._get_in_org(org, kb_id)
        vector = (
            await get_embedding_client().embed([data.query], settings.EMBEDDING_MODEL)
        )[0]
        hits = await get_vector_store().search(vector, kb.id, data.top_k)
        if not hits:
            return SearchResponse(results=[])
        chunks = await self.repo.get_chunks_by_vector_ids(
            {payload.get(PAYLOAD_VECTOR_ID) for _, payload in hits}
        )
        filenames = await self.repo.filenames_by_ids(
            {payload.get(PAYLOAD_DOCUMENT_ID) for _, payload in hits}
        )
        results: list[SearchResultItem] = []
        for score, payload in hits:
            chunk = chunks.get(payload.get(PAYLOAD_VECTOR_ID))
            results.append(
                SearchResultItem(
                    content=chunk.content if chunk is not None else "",
                    document=filenames.get(payload.get(PAYLOAD_DOCUMENT_ID), "未知文档"),
                    page=payload.get(PAYLOAD_PAGE_START),
                    score=round(score, 4),
                )
            )
        return SearchResponse(results=results)

    # ---------- 内部 ----------

    async def _get_in_org(self, org: Organization, kb_id: int) -> KnowledgeBase:
        """归属校验：知识库不存在或不属于当前组织一律 404（不泄露跨组织存在性）"""
        kb = await self.repo.get_kb(kb_id)
        if kb is None or kb.organization_id != org.id:
            raise KnowledgeBaseNotFound()
        return kb

    async def _get_document_in_org(
        self, org: Organization, document_id: int
    ) -> Document:
        """文档归属校验：经其知识库二维校验（doc → kb → org），跨组织 404 不泄露"""
        doc = await self.repo.get_document(document_id)
        if doc is None:
            raise DocumentNotFound()
        kb = await self.repo.get_kb(doc.knowledge_base_id)
        if kb is None or kb.organization_id != org.id:
            raise DocumentNotFound()
        return doc

    @staticmethod
    def _validate_file(filename: str, content: bytes) -> str:
        """文件校验（D6）：扩展名白名单 / 非空 / 大小上限，返回标准化的 file_type"""
        if not filename or "." not in filename:
            raise FileTypeNotSupported()
        file_type = filename.rsplit(".", 1)[-1].lower()
        if file_type not in SUPPORTED_TYPES:
            raise FileTypeNotSupported()
        if not content:
            raise FileEmpty()
        if len(content) > settings.max_upload_size_bytes:
            raise FileTooLarge()
        return file_type

    @staticmethod
    def _kb_dir(kb_id: int) -> Path:
        return Path(settings.UPLOAD_DIR).resolve() / str(kb_id)

    @staticmethod
    def _write_file(path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    @staticmethod
    def _remove_file(path: Path) -> None:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass  # 文件清理尽力而为（可能已被外部清理或权限受限）

    @classmethod
    def _remove_dir(cls, directory: Path) -> None:
        try:
            if not directory.exists():
                return
            for child in directory.iterdir():
                if child.is_file():
                    cls._remove_file(child)
            directory.rmdir()
        except OSError:
            pass

    @staticmethod
    def _kb_detail(
        kb: KnowledgeBase, document_count: int, processing_count: int
    ) -> KnowledgeBaseDetail:
        return KnowledgeBaseDetail(
            id=kb.id,
            name=kb.name,
            description=kb.description,
            embedding_model=kb.embedding_model,
            chunk_size=kb.chunk_size,
            chunk_overlap=kb.chunk_overlap,
            status=kb.status,
            document_count=document_count,
            processing_count=processing_count,
            created_at=kb.created_at,
            updated_at=kb.updated_at,
        )

    @staticmethod
    def _document_item(doc: Document) -> DocumentListItem:
        return DocumentListItem(
            id=doc.id,
            filename=doc.filename,
            file_type=doc.file_type,
            file_size=doc.file_size,
            status=doc.status,
            error_message=doc.error_message,
            chunk_count=doc.chunk_count,
            created_at=doc.created_at,
        )