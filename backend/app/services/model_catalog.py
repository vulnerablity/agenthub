# services/model_catalog.py
# 预置模型目录（model-providers.md D8）：仅创建供应商时按 provider_type 一次性导入
# （幂等，只增不改不删）；目录为示意数据，以各平台官方文档为准；
# 管理员可在创建后自行增删改模型行，后续目录更新不会自动改写已建供应商
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ModelProvider, ProviderModel
from app.schemas.model_provider import DEFAULT_CAPABILITIES

# 各 provider_type 预置模型；capabilities 仅写差异键（缺省键回落 DEFAULT_CAPABILITIES）
PRESET_CATALOGS: dict[str, list[dict]] = {
    "deepseek": [
        {
            "model_key": "deepseek-chat",
            "display_name": "DeepSeek Chat",
            "capabilities": {"tool_call": True},
        },
        {
            "model_key": "deepseek-reasoner",
            "display_name": "DeepSeek Reasoner",
            "capabilities": {"tool_call": False, "reasoning": True},
        },
    ],
    "zhipu": [
        {
            "model_key": "glm-4-flash",
            "display_name": "GLM-4-Flash",
            "capabilities": {"tool_call": True},
        },
        {
            "model_key": "glm-4-plus",
            "display_name": "GLM-4-Plus",
            "capabilities": {"tool_call": True, "reasoning": True},
        },
    ],
    # 火山方舟按接入点（ep-xxx）组织，无通用目录，由用户自填
    "doubao": [],
    # 本地网关模型由用户自填；行级能力由 PROVIDER_TYPE_DEFAULT_CAPABILITIES 兜底
    "ollama": [],
    "openai": [
        {
            "model_key": "gpt-4o-mini",
            "display_name": "GPT-4o mini",
            "capabilities": {"tool_call": True},
        },
    ],
    "custom": [],
}

# 必须配置 api_key 的 provider_type（D8）；集合外类型（ollama/custom）免密可空
REQUIRES_API_KEY: set[str] = {"deepseek", "zhipu", "doubao", "openai"}

# 免密类型的行级默认能力（D9：Ollama 等本地网关不支持 stream_options）
PROVIDER_TYPE_DEFAULT_CAPABILITIES: dict[str, dict[str, bool]] = {
    "ollama": {"tool_call": False, "reasoning": False, "stream_usage": False},
}


def provider_type_default_capabilities(provider_type: str) -> dict[str, bool]:
    """按供应商类型合成行级默认能力：全局默认 → 类型覆盖"""
    return {
        **DEFAULT_CAPABILITIES,
        **PROVIDER_TYPE_DEFAULT_CAPABILITIES.get(provider_type, {}),
    }


async def import_preset(db: AsyncSession, provider: ModelProvider) -> int:
    """一次性导入预置模型（D8 幂等：已存在 model_key 跳过）→ 返回导入条数"""
    presets = PRESET_CATALOGS.get(provider.provider_type, [])
    if not presets:
        return 0
    result = await db.execute(
        select(ProviderModel.model_key).where(
            ProviderModel.provider_id == provider.id
        )
    )
    known = set(result.scalars().all())
    default_caps = provider_type_default_capabilities(provider.provider_type)
    imported = 0
    for preset in presets:
        if preset["model_key"] in known:
            continue
        db.add(
            ProviderModel(
                provider_id=provider.id,
                model_key=preset["model_key"],
                display_name=preset.get("display_name") or preset["model_key"],
                capabilities={**default_caps, **(preset.get("capabilities") or {})},
                enabled=True,
            )
        )
        imported += 1
    await db.flush()
    return imported
