# schemas/tool.py
# 工具域请求/响应模型（对齐需求文档 3.7 / 4.6 / 4.7，tool-calling.md 2.3）
# 字段名 schema 与 pydantic BaseModel 内置属性同名：以 tool_schema 声明 + alias="schema" 保持 API 字段为 schema
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# 工具类型（tool-calling.md D01；Search/Weather 为 HTTP 前端模板，Database 暂缓）
ToolType = Literal["calculator", "http"]

# calculator 固定 input JSON Schema（tool-calling.md 2.4）
CALCULATOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"expression": {"type": "string"}},
    "required": ["expression"],
}


class ToolCreateRequest(BaseModel):
    """创建工具请求（需求 4.6）；schema/config 由 pydantic 校验结构，语义校验在 Service 层"""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    type: ToolType
    tool_schema: dict[str, Any] = Field(default_factory=dict, alias="schema")
    config: dict[str, Any] | None = None


class ToolUpdateRequest(BaseModel):
    """编辑工具请求（需求补充）：仅允许改名称/描述/schema/config，type 创建后不可改"""

    model_config = ConfigDict(populate_by_name=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    tool_schema: dict[str, Any] | None = Field(default=None, alias="schema")
    config: dict[str, Any] | None = None


class ToolDetail(BaseModel):
    """工具详情/列表项（需求 4.6）"""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    description: str | None
    type: str
    tool_schema: dict[str, Any] = Field(alias="schema")
    config: dict[str, Any] | None
    status: str
    created_at: datetime
    updated_at: datetime


class ToolTestRequest(BaseModel):
    """测试工具请求（需求 3.7 POST /tools/{id}/test）：一次执行的输入参数"""

    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolTestResponse(BaseModel):
    """测试工具响应：执行结果统一结构（error 不抛异常，tool-calling.md D11）"""

    status: Literal["ok", "error"]
    output: str
    error: str | None
    duration_ms: int


class AgentToolBindRequest(BaseModel):
    """绑定工具请求（需求 3.7 POST /agents/{id}/tools）：config_json 覆盖 tools.config（D08）"""

    tool_id: int
    enabled: bool = True
    config_json: dict[str, Any] | None = None


class AgentToolUpdateRequest(BaseModel):
    """绑定更新请求（需求补充）：改启用开关 / 绑定级配置"""

    enabled: bool | None = None
    config_json: dict[str, Any] | None = None


class AgentToolDetail(BaseModel):
    """绑定详情：join 工具名与类型（tool-calling.md 2.3）"""

    id: int
    agent_id: int
    tool_id: int
    tool_name: str
    tool_type: str
    tool_description: str | None
    enabled: bool
    config_json: dict[str, Any] | None
    created_at: datetime


class ToolCallRun(BaseModel):
    """单次工具调用轨迹（SSE done.tool_calls 与 messages.metadata_json.tool_calls 共用）"""

    round: int
    name: str
    arguments: dict[str, Any]
    status: Literal["ok", "error"]
    output: str
    error: str | None
