# models/document.py
# 知识库文档表（对齐需求 4.9；chunk_count / processing_started_at 为 knowledge.md 增补列）
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # 知识库删除时文档级联删除（knowledge.md D9；chunks 随 documents 再级联）
    knowledge_base_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    # pending / processing / completed / failed（knowledge.md 3.4 状态机）
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 置 processing 时写入；重启恢复与未来僵尸任务判定依据（knowledge.md 3.2）
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    chunk_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
