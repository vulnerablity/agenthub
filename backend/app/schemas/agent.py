# schemas/agent.py
# agent 模块请求/响应模型（与 models/agent.py 字段对齐）
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# 智能体状态：enabled / disabled（D4：启停即时生效、不删配置）
AgentStatus = Literal["enabled", "disabled"]


class AgentCreateRequest(BaseModel):
    """创建智能体请求：temperature / max_tokens 为 None 表示取运行时默认"""

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    provider: str = Field(min_length=1, max_length=50)
    model: str = Field(min_length=1, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=100000)
    system_prompt: str = Field(default="", max_length=10000)


class AgentUpdateRequest(BaseModel):
    """编辑智能体请求：全字段可选（未传不动）；description/temperature/max_tokens/system_prompt 传 null 表示清空"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    provider: str | None = Field(default=None, min_length=1, max_length=50)
    model: str | None = Field(default=None, min_length=1, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=100000)
    system_prompt: str | None = Field(default=None, max_length=10000)


class AgentStatusRequest(BaseModel):
    """启停请求"""

    status: AgentStatus


class AgentListItem(BaseModel):
    """智能体列表项（列表轻量，不含提示词与温度等参数）"""

    id: int
    name: str
    description: str | None
    provider: str
    model: str
    status: str
    updated_at: datetime


class AgentDetail(BaseModel):
    """智能体详情：列表字段 + 完整配置 + 创建者"""

    id: int
    name: str
    description: str | None
    system_prompt: str
    provider: str
    model: str
    temperature: float | None
    max_tokens: int | None
    status: str
    created_by_username: str
    created_at: datetime
    updated_at: datetime
