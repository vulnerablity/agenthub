# models/knowledge_base.py
# 知识库表：组织作用域；embedding_model 落库启动期全局模型值，Worker 按此调用（knowledge.md D2）
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 全局单一 Embedding 模型在系统启动期确定，运行期不可切换（knowledge.md D2）
    embedding_model: Mapped[str] = mapped_column(String(100), nullable=False)
    chunk_size: Mapped[int] = mapped_column(
        Integer, nullable=False, default=500, server_default="500"
    )
    chunk_overlap: Mapped[int] = mapped_column(
        Integer, nullable=False, default=50, server_default="50"
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_kb_name"),
    )