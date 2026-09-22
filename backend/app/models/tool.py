# models/tool.py
# 工具与绑定表（对应需求 4.6 / 4.7，tool-calling.md 2.2）：组织作用域，名称组织内唯一（D02）
# 绑定为 Agent 级（D05），工具/智能体删除随外键 CASCADE 清理（D04）
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Tool(Base):
    __tablename__ = "tools"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # type 枚举：calculator / http（pydantic 层校验，tool-calling.md D01）
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    # schema = 传给 LLM 的 input JSON Schema（function.parameters，D06）
    schema: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # config = 执行器固定配置（http 有 url/method/headers/body；calculator 为 null，D06）
    config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active"
    )
    # 预留系统预置工具（无 owner，D07）
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_tool_name"),)


class AgentTool(Base):
    __tablename__ = "agent_tools"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    agent_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("agents.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tool_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("tools.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    # 非 null 时整体覆盖 tools.config（绑定级 override，D08）
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (UniqueConstraint("agent_id", "tool_id", name="uq_agent_tool"),)
