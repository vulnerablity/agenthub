# schemas/agent.py
# agent 模块请求/响应模型（对齐需求文档 3.3 / 4.4 / 4.5）
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# 智能体状态（需求 3.3 创建字段含「状态」）
AgentStatus = Literal["enabled", "disabled"]


class AgentCreateRequest(BaseModel):
    """创建智能体请求：基础信息 + 初始配置（自动生成 v1 并发布）"""

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    avatar_url: str | None = Field(default=None, max_length=500)
    status: AgentStatus = "enabled"
    system_prompt: str = Field(default="", max_length=10000)
    model_provider: str = Field(min_length=1, max_length=50)
    model_name: str = Field(min_length=1, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=100000)
    config_json: dict[str, Any] | None = None


class AgentUpdateRequest(BaseModel):
    """编辑基础信息请求（需求 3.3 编辑中描述/头像类字段；模型与提示词走版本流程）"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    avatar_url: str | None = Field(default=None, max_length=500)


class AgentStatusRequest(BaseModel):
    """启停请求"""

    status: AgentStatus


class AgentListItem(BaseModel):
    """智能体列表项（需求 3.3 列表：名称/当前版本/状态/创建时间）"""

    id: int
    name: str
    description: str | None
    avatar_url: str | None
    status: str
    current_version: int | None
    created_at: datetime
    updated_at: datetime


class AgentVersionCreateRequest(BaseModel):
    """创建版本请求（需求 4.5 字段）"""

    system_prompt: str = Field(default="", max_length=10000)
    model_provider: str = Field(min_length=1, max_length=50)
    model_name: str = Field(min_length=1, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=100000)
    config_json: dict[str, Any] | None = None


class AgentVersionItem(BaseModel):
    """版本信息（需求 3.4 版本列表；is_current 由 agents.current_version_id 计算，不落库）"""

    id: int
    version: int
    system_prompt: str
    model_provider: str
    model_name: str
    temperature: float | None
    max_tokens: int | None
    config_json: dict[str, Any] | None
    created_by_username: str
    created_at: datetime
    is_current: bool


class AgentDetail(BaseModel):
    """智能体详情：基础信息 + 当前版本完整配置"""

    id: int
    name: str
    description: str | None
    avatar_url: str | None
    status: str
    current_version: int | None
    current_version_detail: AgentVersionItem | None
    created_by_username: str
    created_at: datetime
    updated_at: datetime
