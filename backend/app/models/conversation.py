# models/conversation.py
# 会话表（对齐需求 4.11 + 设计文档 chat.md D6 扩充 agent_version_id）
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # 会话用户私有（chat.md D1）：仅创建者可访问
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True, nullable=False
    )
    # Agent 删除时会话随外键级联清理（chat.md D14）
    agent_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("agents.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # 创建时快照自 agents.current_version_id（chat.md D6）；版本被级联删除时置空兜底
    agent_version_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("agent_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
