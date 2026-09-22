# models/execution_log.py
# 执行监控数据表（对齐需求 4.13 agent_execution_logs / 4.14 llm_usage_logs，execution.md D1/D2）
# D4：审计数据不设外键（agent_id/conversation_id 仅存数值），Agent 硬删除/会话删除不级联清理日志
# D1：无需求外的执行主表，execution_id（UUID 字符串）为分组键，一次"生成"（send/stream）一个 execution
# D6：步骤完成后一次性落库（status=success/error），耗时由业务层 monotonic 计时写入 duration_ms/latency_ms
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ExecutionStep(Base):
    __tablename__ = "agent_execution_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # 一次生成的 UUID 分组键（D1）；另加 organization_id/user_id 供组织隔离与 member 本人可见过滤（D3）
    execution_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    organization_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    agent_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    conversation_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    # step_type：llm / rag / tool；step_name 细分（如 llm_round_1 / rag_retrieval / tool_计算器）
    step_type: Mapped[str] = mapped_column(String(20), nullable=False)
    step_name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    # 入参/出参（截断上限 MAX_JSON_CHARS，超长记 {"truncated": true, "preview": ...}）
    input_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    output_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class LLMUsageLog(Base):
    __tablename__ = "llm_usage_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    execution_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    organization_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    # 比需求 4.14 补充 conversation_id 与 round：tool-calling 多轮 = 一个 execution 下多条 usage（D2）
    agent_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    conversation_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
