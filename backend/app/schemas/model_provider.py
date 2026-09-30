# schemas/model_provider.py
# 模型供应商模块请求/响应模型（model-providers.md §6）
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# 能力矩阵标准结构（model-providers.md D4）：缺省 = 现状行为
# （tool_call/stream_usage 开、reasoning 关），自定义模型未登记时同样按此兜底
DEFAULT_CAPABILITIES: dict[str, bool] = {
    "tool_call": True,
    "reasoning": False,
    "stream_usage": True,
}

ErrorType = Literal["auth", "model_not_found", "network", "forbidden", "unknown"]


class ProviderModelCapabilities(BaseModel):
    """能力矩阵（D4）：仅白名单键 + 布尔值，service 层 dump 后落 JSON 列"""

    tool_call: bool = True
    reasoning: bool = False
    stream_usage: bool = True


class ProviderModelItem(BaseModel):
    """供应商模型清单项"""

    id: int
    model_key: str
    display_name: str
    capabilities: dict[str, Any] | None
    enabled: bool


class ModelProviderCreateRequest(BaseModel):
    """创建供应商请求（§6 POST）；api_key 缺省/空串 = 免密（仅免密类型允许）"""

    name: str = Field(min_length=1, max_length=100)
    provider_type: str = Field(min_length=1, max_length=30)
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=2000)
    enabled: bool = True


class ModelProviderUpdateRequest(BaseModel):
    """部分更新请求；api_key 三态语义（D5）：
    字段缺省 = 保留原值；空串/null = 显式清空（仅免密类型）；非空字符串 = 替换。
    provider_type 创建后不可变（目录导入语义，D8）"""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None


class ModelProviderDetail(BaseModel):
    """供应商详情/列表项：api_key 仅掩码（D5），key_status 供 UI 判断是否需重填"""

    id: int
    name: str
    provider_type: str
    base_url: str
    api_key_masked: str | None
    key_status: Literal["empty", "set", "invalid"]
    enabled: bool
    models: list[ProviderModelItem]
    created_at: datetime


class ProviderModelCreateRequest(BaseModel):
    """新增模型行请求（§6 POST /{id}/models）"""

    model_key: str = Field(min_length=1, max_length=100)
    display_name: str | None = Field(default=None, max_length=100)
    capabilities: ProviderModelCapabilities | None = None
    enabled: bool = True


class ProviderModelUpdateRequest(BaseModel):
    """编辑模型行请求；model_key 创建后不可变（版本弱引用的匹配键）"""

    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    capabilities: ProviderModelCapabilities | None = None
    enabled: bool | None = None


class TestConnectionRequest(BaseModel):
    """测试连接请求（D13 两模式）：model_key 缺省 → GET /models（连通 + 鉴权）；
    提供 → POST /chat/completions(max_tokens=1)。provider_type 供必密校验"""

    base_url: str = Field(min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=2000)
    model_key: str | None = Field(default=None, max_length=100)
    provider_type: str | None = Field(default=None, max_length=30)


class TestConnectionResponse(BaseModel):
    """测试连接响应（D13）：测试失败不抛 HTTP 错误，ok=false + error_type"""

    ok: bool
    latency_ms: int
    error_type: ErrorType | None = None
    message: str | None = None
