# repositories/knowledge_repo.py
# knowledge_bases / documents / document_chunks 数据访问层（Service 层不直接写 SQL）
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, DocumentChunk, KnowledgeBase


class KnowledgeRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---------- KnowledgeBase ----------

    async def get_kb(self, kb_id: int) -> KnowledgeBase | None:
        return await self.db.get(KnowledgeBase, kb_id)

    async def name_exists(self, org_id: int, name: str) -> bool:
        """组织内名称占用检查（唯一约束预查，knowledge.md D1）"""
        result = await self.db.execute(
            select(KnowledgeBase.id)
            .where(KnowledgeBase.organization_id == org_id, KnowledgeBase.name == name)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def create_kb(self, kb: KnowledgeBase) -> KnowledgeBase:
        """新增知识库并 flush 拿到自增 id"""
        self.db.add(kb)
        await self.db.flush()
        return kb

    async def kb_with_counts(
        self, org_id: int, kb_id: int
    ) -> tuple[KnowledgeBase, int, int] | None:
        """组织内单个知识库 + 文档总数 / 处理中数（隔离校验与统计一次查询完成）"""
        result = await self.db.execute(
            select(
                KnowledgeBase,
                func.count(Document.id),
                func.coalesce(
                    func.sum(case((Document.status == "processing", 1), else_=0)), 0
                ),
            )
            .outerjoin(Document, Document.knowledge_base_id == KnowledgeBase.id)
            .where(KnowledgeBase.id == kb_id, KnowledgeBase.organization_id == org_id)
            .group_by(KnowledgeBase.id)
        )
        row = result.one_or_none()
        if row is None:
            return None
        return row[0], int(row[1] or 0), int(row[2] or 0)

    async def list_kb_with_counts(
        self, org_id: int
    ) -> list[tuple[KnowledgeBase, int, int]]:
        """组织内知识库列表（含文档总数 / 处理中数），最近更新在前"""
        result = await self.db.execute(
            select(
                KnowledgeBase,
                func.count(Document.id),
                func.coalesce(
                    func.sum(case((Document.status == "processing", 1), else_=0)), 0
                ),
            )
            .outerjoin(Document, Document.knowledge_base_id == KnowledgeBase.id)
            .where(KnowledgeBase.organization_id == org_id)
            .group_by(KnowledgeBase.id)
            .order_by(KnowledgeBase.updated_at.desc(), KnowledgeBase.id.desc())
        )
        return [(row[0], int(row[1] or 0), int(row[2] or 0)) for row in result.all()]

    async def delete_kb(self, kb: KnowledgeBase) -> None:
        """删除知识库（documents 随外键 CASCADE 再级联 chunks，knowledge.md D9）"""
        await self.db.delete(kb)

    async def kb_ids_by_org(self, org_id: int) -> list[int]:
        """组织内全部知识库 id（解散组织前清理用）"""
        result = await self.db.execute(
            select(KnowledgeBase.id).where(KnowledgeBase.organization_id == org_id)
        )
        return list(result.scalars().all())

    async def delete_kb_by_org(self, org_id: int) -> None:
        await self.db.execute(
            delete(KnowledgeBase).where(KnowledgeBase.organization_id == org_id)
        )

    # ---------- Document ----------

    async def get_document(self, document_id: int) -> Document | None:
        return await self.db.get(Document, document_id)

    async def create_document(self, document: Document) -> Document:
        self.db.add(document)
        await self.db.flush()
        return document

    async def list_documents(self, kb_id: int) -> list[Document]:
        result = await self.db.execute(
            select(Document)
            .where(Document.knowledge_base_id == kb_id)
            .order_by(Document.created_at.desc(), Document.id.desc())
        )
        return list(result.scalars().all())

    async def has_processing(self, kb_id: int) -> bool:
        """知识库内是否存在处理中文档（KB 删除前的 409 判定，knowledge.md D9）"""
        result = await self.db.execute(
            select(Document.id)
            .where(Document.knowledge_base_id == kb_id, Document.status == "processing")
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def delete_document(self, document: Document) -> None:
        await self.db.delete(document)

    async def filenames_by_ids(self, document_ids: set[int]) -> dict[int, str]:
        if not document_ids:
            return {}
        result = await self.db.execute(
            select(Document.id, Document.filename).where(Document.id.in_(document_ids))
        )
        return {doc_id: filename for doc_id, filename in result.all()}

    async def list_recoverable(self) -> list[Document]:
        """重启恢复：所有未完成文档（pending / processing → 重置后重新入队，knowledge.md 3.4）"""
        result = await self.db.execute(
            select(Document).where(Document.status.in_(("pending", "processing")))
        )
        return list(result.scalars().all())

    # ---------- DocumentChunk ----------

    async def delete_chunks_by_document(self, document_id: int) -> None:
        """清理文档已有切块（重跑前幂等清理，knowledge.md 3.4 双写一致性）"""
        await self.db.execute(
            delete(DocumentChunk).where(DocumentChunk.document_id == document_id)
        )

    async def get_chunks_by_vector_ids(
        self, vector_ids: set[str]
    ) -> dict[str, DocumentChunk]:
        if not vector_ids:
            return {}
        result = await self.db.execute(
            select(DocumentChunk).where(DocumentChunk.vector_id.in_(vector_ids))
        )
        return {chunk.vector_id: chunk for chunk in result.scalars().all()}
