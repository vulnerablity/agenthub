# integrations/vector_store.py
# Qdrant 封装：单 collection「knowledge_chunks」+ payload 过滤（knowledge.md D2/D3）
# 职责边界：纯基础设施组件——Qdrant 不承载租户权限（D4 补充原则），本层只按 kb_id/document_id
# 执行 upsert/search/delete，权限校验必须已在 Service 层完成；测试/本地可整体替换或 :memory: 模式
from qdrant_client import AsyncQdrantClient, models

from app.core.config import settings
from app.core.exceptions import VectorStoreError

COLLECTION = "knowledge_chunks"

# point payload 键（与 documents / document_chunks 行一一对应，knowledge.md 3.2/3.4）
PAYLOAD_KB_ID = "kb_id"
PAYLOAD_DOCUMENT_ID = "document_id"
PAYLOAD_CHUNK_INDEX = "chunk_index"
PAYLOAD_VECTOR_ID = "vector_id"  # 检索结果经此回查 document_chunks 取 content
PAYLOAD_PAGE_START = "page_start"
PAYLOAD_PAGE_END = "page_end"


class VectorStore:
    """Qdrant 异步客户端封装；collection 在首次 upsert 时按实测向量维度懒创建（Cosine）"""

    def __init__(self, url: str, api_key: str) -> None:
        self._url = url
        self._api_key = api_key
        self._client: AsyncQdrantClient | None = None

    def _get_client(self) -> AsyncQdrantClient:
        if self._client is None:
            if self._url == ":memory:":
                # 本地内存模式（测试/降级用），无需真实服务
                self._client = AsyncQdrantClient(location=":memory:")
            else:
                self._client = AsyncQdrantClient(
                    url=self._url, api_key=self._api_key or None
                )
        return self._client

    async def _ensure_collection(self, dim: int) -> None:
        client = self._get_client()
        try:
            if not await client.collection_exists(COLLECTION):
                await client.create_collection(
                    collection_name=COLLECTION,
                    vectors_config=models.VectorParams(
                        size=dim, distance=models.Distance.COSINE
                    ),
                )
        except Exception as exc:
            raise VectorStoreError() from exc

    async def upsert(
        self,
        points: list[tuple[str, list[float], dict]],
    ) -> None:
        """批量写入：point = (vector_id, vector, payload)；首次写入按维度建 collection"""
        if not points:
            return
        await self._ensure_collection(len(points[0][1]))
        client = self._get_client()
        try:
            await client.upsert(
                collection_name=COLLECTION,
                wait=True,
                points=[
                    models.PointStruct(id=vector_id, vector=vector, payload=payload)
                    for vector_id, vector, payload in points
                ],
            )
        except Exception as exc:
            raise VectorStoreError() from exc

    async def search(
        self, vector: list[float], kb_id: int, limit: int
    ) -> list[tuple[float, dict]]:
        """按 kb filter 检索（租户校验已在 Service 层完成），返回 [(score, payload)]"""
        client = self._get_client()
        try:
            result = await client.query_points(
                collection_name=COLLECTION,
                query=vector,
                query_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key=PAYLOAD_KB_ID,
                            match=models.MatchValue(value=kb_id),
                        )
                    ]
                ),
                limit=limit,
            )
        except Exception as exc:
            raise VectorStoreError() from exc
        return [(p.score, p.payload or {}) for p in result.points]

    async def delete_document(self, document_id: int) -> None:
        """按 document_id 清理该文档全部向量点（删除接口/Worker 失败清理共用，D9）"""
        await self._delete_by(PAYLOAD_DOCUMENT_ID, document_id)

    async def delete_kb(self, kb_id: int) -> None:
        """按 kb_id 清理该知识库全部向量点（KB 删除/组织解散共用，D9）"""
        await self._delete_by(PAYLOAD_KB_ID, kb_id)

    async def _delete_by(self, key: str, value: int) -> None:
        client = self._get_client()
        try:
            await client.delete(
                collection_name=COLLECTION,
                wait=True,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key=key, match=models.MatchValue(value=value)
                            )
                        ]
                    )
                ),
            )
        except Exception as exc:
            raise VectorStoreError() from exc

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.close()


_store: VectorStore | None = None


def get_vector_store() -> VectorStore:
    """模块级单例（测试以 monkeypatch VectorStore 方法替换真实向量库调用）"""
    global _store
    if _store is None:
        _store = VectorStore(settings.QDRANT_URL, settings.QDRANT_API_KEY)
    return _store