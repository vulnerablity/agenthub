# models/model_provider.py
# 模型供应商表：组织作用域的平台凭证（base_url + 加密 api_key，model-providers.md D1/D5）
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ModelProvider(Base):
    __tablename__ = "model_providers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 目录匹配键（deepseek/zhipu/doubao/ollama/openai/custom），创建后不可变
    provider_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="custom", server_default="custom"
    )
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    # Fernet 密文（D5）；免密类型（ollama/custom 等本地服务）为 NULL
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=func.true()
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # 供应商删除时模型清单随外键 CASCADE；ORM 侧 delete-orphan 保证内存一致
    models: Mapped[list["ProviderModel"]] = relationship(  # noqa: F821
        "ProviderModel",
        back_populates="provider",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProviderModel.id",
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_model_provider_org_name"),
    )
