# models/provider_model.py
# 供应商模型清单表：精确模型标识 + 能力矩阵 JSON（model-providers.md D4），随供应商级联删除
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.model_provider import ModelProvider


class ProviderModel(Base):
    __tablename__ = "provider_models"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("model_providers.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # 精确模型标识（deepseek-chat / ep-2024xxxx / glm-4-flash），供应商内唯一
    model_key: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 能力矩阵（D4）：tool_call / reasoning / stream_usage，缺键回落默认能力
    capabilities: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    provider: Mapped["ModelProvider"] = relationship(back_populates="models")

    __table_args__ = (
        UniqueConstraint("provider_id", "model_key", name="uq_provider_model_key"),
    )
