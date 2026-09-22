# schemas/execution.py
# 执行监控响应模型（需求 3.8 / 4.13 / 4.14，execution.md）：列表为 execution_id 分组聚合，详情含步骤链路与用量
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ExecutionStepItem(BaseModel):
    """执行步骤（4.13）：LLM 轮次 / RAG 检索 / 工具调用"""

    id: int
    step_type: str
    step_name: str
    status: str
    input_json: dict[str, Any] | None
    output_json: dict[str, Any] | None
    duration_ms: int
    created_at: datetime


class LLMUsageItem(BaseModel):
    """LLM 调用用量（4.14）：tool-calling 多轮产生多条"""

    id: int
    provider: str
    model: str
    round: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    latency_ms: int
    created_at: datetime


class ExecutionSummary(BaseModel):
    """execution 聚合摘要（列表项）：总耗时为各步骤 duration_ms 合计（毫秒精确）"""

    execution_id: str
    agent_id: int
    agent_name: str | None
    conversation_id: int
    user_id: int
    started_at: datetime
    finished_at: datetime
    duration_ms: int
    step_count: int
    error_steps: int
    status: str
    total_tokens: int
    llm_latency_ms: int


class ExecutionListResponse(BaseModel):
    """execution 分页列表（D7：聚合查询带总数）"""

    items: list[ExecutionSummary]
    total: int


class ExecutionDetail(ExecutionSummary):
    """执行详情：汇总 + 步骤链路 + LLM 用量"""

    steps: list[ExecutionStepItem]
    usages: list[LLMUsageItem]
