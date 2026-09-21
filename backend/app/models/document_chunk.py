# models/document_chunk.py
# 文档切块表（对齐需求 4.10）：vector_id 指向 Qdrant point，删除时按点/按 document 过滤清理（knowledge.md D9）
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("documents.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # 解析元数据：{"page_start": n, "page_end": m}（knowledge.md D8）
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    vector_id: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_chunk_index"),
    )
