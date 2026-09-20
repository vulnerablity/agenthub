# models/agent.py
# 智能体表：组织作用域；配置项（提示词/模型参数）存放在 agent_versions（对应需求 4.4）
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="enabled", server_default="enabled"
    )
    # 当前发布版本；与 agent_versions 构成环形外键，用 use_alter 延迟建约束（对应需求 4.4 current_version_id）
    current_version_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "agent_versions.id",
            use_alter=True,
            name="fk_agents_current_version",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_agent_name"),
    )
