# tests/test_provider_chat.py
# 供应商路由单元测试（model-providers.md §11.7）：
# _resolve_provider 两档解析（D2/D4）+ LLMClient.chat_stream payload 回归断言
# （caps=None 与旧行为逐字节一致，含 stream_options；stream_usage=False 不携带）
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.exceptions import ModelProviderDisabled, ProviderKeyInvalid
from app.integrations import llm as llm_module
from app.models import Agent, AgentVersion, ModelProvider, Organization, ProviderModel, User
from app.schemas.model_provider import DEFAULT_CAPABILITIES
from app.services.chat_service import ChatService
from app.utils.crypto import encrypt_api_key

# ---------- 夹具 ----------


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", Fernet.generate_key().decode())


@pytest_asyncio.fixture
async def scene(db):
    """org + user + agent + 两个供应商（一个启用带模型，一个停用）"""
    user = User(email="chat@a.com", username="chat", password_hash="x")
    db.add(user)
    await db.flush()
    org = Organization(name="ChatOrg", owner_id=user.id)
    db.add(org)
    await db.flush()
    agent = Agent(
        organization_id=org.id, name="A", created_by=user.id, status="enabled"
    )
    db.add(agent)
    await db.flush()
    provider = ModelProvider(
        organization_id=org.id,
        name="主力",
        provider_type="deepseek",
        base_url="https://api.deepseek.com/v1",
        api_key_encrypted=encrypt_api_key("sk-live-12345678"),
        enabled=True,
        created_by=user.id,
    )
    disabled_provider = ModelProvider(
        organization_id=org.id,
        name="停用",
        provider_type="deepseek",
        base_url="https://api.deepseek.com/v1",
        enabled=False,
        created_by=user.id,
    )
    db.add_all([provider, disabled_provider])
    await db.flush()
    db.add_all(
        [
            ProviderModel(
                provider_id=provider.id,
                model_key="deepseek-chat",
                display_name="Chat",
                capabilities={"tool_call": True, "stream_usage": True},
                enabled=True,
            ),
            ProviderModel(
                provider_id=provider.id,
                model_key="deepseek-reasoner",
                display_name="Reasoner",
                capabilities={"tool_call": False, "reasoning": True},
                enabled=True,
            ),
            ProviderModel(
                provider_id=provider.id,
                model_key="off-model",
                display_name="Off",
                capabilities=None,
                enabled=False,
            ),
        ]
    )
    await db.commit()

    async def make_version(provider_id, model_name, provider_label="deepseek"):
        v = AgentVersion(
            agent_id=agent.id,
            version=len(agent_versions) + 1,
            system_prompt="s",
            provider_id=provider_id,
            model_provider=provider_label,
            model_name=model_name,
            created_by=user.id,
        )
        db.add(v)
        await db.commit()
        await db.refresh(v)
        agent_versions.append(v)
        return v

    agent_versions: list[AgentVersion] = []
    return {
        "org": org,
        "user": user,
        "agent": agent,
        "provider": provider,
        "disabled_provider": disabled_provider,
        "make_version": make_version,
    }


# ---------- _resolve_provider（D2/D4） ----------


@pytest.mark.asyncio
async def test_resolve_provider_none_is_legacy_path(db, scene):
    """provider_id IS NULL → 三元 None，不触碰供应商表（旧路径逐字节不变）"""
    version = await scene["make_version"](None, "gpt-x")
    base_url, api_key, caps = await ChatService(db)._resolve_provider(
        scene["org"], version
    )
    assert base_url is None and api_key is None and caps is None


@pytest.mark.asyncio
async def test_resolve_provider_known_model_caps(db, scene):
    """命中模型行 → 供应商凭证 + 行级能力矩阵"""
    version = await scene["make_version"](scene["provider"].id, "deepseek-reasoner")
    base_url, api_key, caps = await ChatService(db)._resolve_provider(
        scene["org"], version
    )
    assert base_url == "https://api.deepseek.com/v1"
    assert api_key == "sk-live-12345678"
    assert caps == {"tool_call": False, "reasoning": True, "stream_usage": True}


@pytest.mark.asyncio
async def test_resolve_provider_custom_model_defaults(db, scene):
    """未登记模型（自定义兜底）与禁用模型行均 → D4 默认能力"""
    service = ChatService(db)
    custom = await scene["make_version"](scene["provider"].id, "my-own-model")
    _, _, caps = await service._resolve_provider(scene["org"], custom)
    assert caps == DEFAULT_CAPABILITIES
    off = await scene["make_version"](scene["provider"].id, "off-model")
    _, _, caps = await service._resolve_provider(scene["org"], off)
    assert caps == DEFAULT_CAPABILITIES


@pytest.mark.asyncio
async def test_resolve_provider_disabled_and_bad_key(db, scene):
    """供应商停用 → 502；密文损坏 → 502 ProviderKeyInvalid"""
    service = ChatService(db)
    version = await scene["make_version"](scene["disabled_provider"].id, "deepseek-chat")
    with pytest.raises(ModelProviderDisabled):
        await service._resolve_provider(scene["org"], version)
    # 破坏密文
    provider = scene["provider"]
    provider.api_key_encrypted = "not-a-valid-cipher"
    await db.commit()
    version = await scene["make_version"](provider.id, "deepseek-chat")
    with pytest.raises(ProviderKeyInvalid):
        await service._resolve_provider(scene["org"], version)


# ---------- LLMClient.chat_stream payload（D9 回归） ----------


class _FakeResp:
    status_code = 200

    async def aiter_lines(self) -> AsyncIterator[str]:
        yield "data: [DONE]"


class _FakeHttpxClient:
    """替身 httpx 客户端：捕获 stream 入参，产出 [DONE] 空流"""

    captured: dict | None = None

    def stream(self, method, url, json=None, headers=None):
        _FakeHttpxClient.captured = {
            "method": method,
            "url": url,
            "json": json,
            "headers": headers,
        }
        return self

    async def __aenter__(self) -> _FakeResp:
        return _FakeResp()

    async def __aexit__(self, *args) -> bool:
        return False

    async def aclose(self) -> None:
        return None


def _capture(monkeypatch) -> None:
    """替换单例内部 httpx 客户端并复位捕获容器"""
    _FakeHttpxClient.captured = None
    client = llm_module.get_llm_client()
    monkeypatch.setattr(client, "_client", _FakeHttpxClient())


async def _drain(gen: AsyncIterator[dict]) -> None:
    async for _ in gen:
        pass


@pytest.mark.asyncio
async def test_llm_payload_legacy_path_unchanged(monkeypatch):
    """旧路径（不传新参）：url/Authorization/stream_options 与改造前逐字节一致"""
    monkeypatch.setattr(settings, "LLM_API_BASE", "https://gw.example.com/v1")
    monkeypatch.setattr(settings, "LLM_API_KEY", "sk-global-key-0001")
    _capture(monkeypatch)
    await _drain(
        llm_module.get_llm_client().chat_stream(
            messages=[{"role": "user", "content": "hi"}], model="m1"
        )
    )
    cap = _FakeHttpxClient.captured
    assert cap["url"] == "https://gw.example.com/v1/chat/completions"
    assert cap["headers"]["Authorization"] == "Bearer sk-global-key-0001"
    assert cap["json"]["stream_options"] == {"include_usage": True}
    assert "tools" not in cap["json"]


@pytest.mark.asyncio
async def test_llm_payload_provider_override_and_no_stream_options(monkeypatch):
    """供应商路径：base_url/api_key 覆盖；stream_usage=False 不携带 stream_options（D9）"""
    monkeypatch.setattr(settings, "LLM_API_BASE", "https://gw.example.com/v1")
    monkeypatch.setattr(settings, "LLM_API_KEY", "sk-global-key-0001")
    _capture(monkeypatch)
    await _drain(
        llm_module.get_llm_client().chat_stream(
            messages=[{"role": "user", "content": "hi"}],
            model="m1",
            tools=[{"type": "function", "function": {"name": "t"}}],
            base_url="https://api.deepseek.com/v1",
            api_key="sk-provider-key-0002",
            stream_usage=False,
        )
    )
    cap = _FakeHttpxClient.captured
    assert cap["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert cap["headers"]["Authorization"] == "Bearer sk-provider-key-0002"
    assert "stream_options" not in cap["json"]
    assert cap["json"]["tools"] and cap["json"]["tool_choice"] == "auto"


@pytest.mark.asyncio
async def test_llm_payload_stream_options_default_kept(monkeypatch):
    """默认 stream_usage=True 保留 stream_options（与现状一致）"""
    _capture(monkeypatch)
    await _drain(
        llm_module.get_llm_client().chat_stream(
            messages=[{"role": "user", "content": "hi"}], model="m1"
        )
    )
    assert _FakeHttpxClient.captured["json"]["stream_options"] == {
        "include_usage": True
    }
