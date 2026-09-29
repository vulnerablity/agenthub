# tests/test_model_providers.py
# 模型供应商接口集成测试（model-providers.md §11）：
# CRUD + 预置目录导入 / 密钥加密与掩码 / api_key 三态 / 组织隔离与权限 / 引用删除保护 /
# 版本创建模型校验（D12）/ SSRF 防护 / 测试连接两模式与 error_type 映射
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet

from app.core.config import settings

PASSWORD = "secret123"


async def _register(client, email, username):
    """注册并返回 email，便于 `await _token(client, await _register(...))` 串联"""
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": PASSWORD},
    )
    return email


async def _token(client, email):
    resp = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
    )
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _hdr(token, org_id):
    return {"Authorization": f"Bearer {token}", "X-Organization-Id": str(org_id)}


async def _create_org(client, token, name="Acme"):
    return (
        await client.post(
            "/api/v1/organizations", json={"name": name}, headers=_auth(token)
        )
    ).json()


async def _create_provider(client, token, org_id, name="DeepSeek 主力", **overrides):
    payload = {
        "name": name,
        "provider_type": "deepseek",
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "sk-test-1234567890abcd",
        **overrides,
    }
    return await client.post(
        "/api/v1/model-providers", json=payload, headers=_hdr(token, org_id)
    )


@pytest_asyncio.fixture(autouse=True)
async def encryption_key(monkeypatch):
    """每个用例注入合法 Fernet 测试密钥（生产由 env 提供）"""
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", Fernet.generate_key().decode())


# ---------- CRUD + 预置目录（D8） ----------


@pytest.mark.asyncio
async def test_create_with_preset_import_and_mask(client):
    """创建供应商：deepseek 目录自动导入；api_key 仅回掩码"""
    token = await _token(client, await _register(client, "p1@a.com", "p1"))
    org = await _create_org(client, token)
    resp = await _create_provider(client, token, org["id"])
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "DeepSeek 主力"
    assert body["key_status"] == "set"
    assert body["api_key_masked"] == "sk-****abcd"
    # 预置目录一次性导入（deepseek 两行）
    assert [m["model_key"] for m in body["models"]] == [
        "deepseek-chat",
        "deepseek-reasoner",
    ]
    # 掩码不泄露明文
    assert "sk-test-1234567890abcd" not in resp.text


@pytest.mark.asyncio
async def test_api_key_encrypted_in_db(client, engine):
    """D5：库内仅存密文，明文不可见"""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import ModelProvider

    token = await _token(client, await _register(client, "p2@a.com", "p2"))
    org = await _create_org(client, token)
    body = (await _create_provider(client, token, org["id"])).json()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        provider = await session.get(ModelProvider, body["id"])
        assert provider.api_key_encrypted is not None
        assert "sk-test-1234567890abcd" not in provider.api_key_encrypted


@pytest.mark.asyncio
async def test_create_name_conflict_and_required_key(client, monkeypatch):
    """组织内名称唯一；必密类型缺 key → 422"""
    # 本机 Ollama 场景：http/内网需部署开关（D6）
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_PROVIDER_URL", True)
    token = await _token(client, await _register(client, "p3@a.com", "p3"))
    org = await _create_org(client, token)
    assert (await _create_provider(client, token, org["id"])).status_code == 201
    dup = await _create_provider(client, token, org["id"])
    assert dup.status_code == 409
    assert dup.json()["code"] == "MODEL_PROVIDER_NAME_CONFLICT"
    no_key = await _create_provider(
        client, token, org["id"], name="DS3", api_key=""
    )
    assert no_key.status_code == 422
    assert no_key.json()["code"] == "MODEL_PROVIDER_FIELD_REQUIRED"
    # 免密类型（ollama）允许无 key
    ollama = await _create_provider(
        client,
        token,
        org["id"],
        name="本地 Ollama",
        provider_type="ollama",
        base_url="http://localhost:11434/v1",
        api_key="",
    )
    assert ollama.status_code == 201
    assert ollama.json()["key_status"] == "empty"


@pytest.mark.asyncio
async def test_update_three_state_api_key(client):
    """D5 三态：缺省保留 / 非空替换 / 空串清空（必密类型 422、免密类型允许）"""
    token = await _token(client, await _register(client, "p4@a.com", "p4"))
    org = await _create_org(client, token)
    body = (await _create_provider(client, token, org["id"])).json()
    pid = body["id"]
    hdr = _hdr(token, org["id"])

    # 缺省 api_key → 保留（掩码不变）
    kept = await client.patch(
        f"/api/v1/model-providers/{pid}", json={"name": "改名"}, headers=hdr
    )
    assert kept.status_code == 200
    assert kept.json()["api_key_masked"] == "sk-****abcd"

    # 非空替换
    replaced = await client.patch(
        f"/api/v1/model-providers/{pid}",
        json={"api_key": "sk-new-key-99887766"},
        headers=hdr,
    )
    assert replaced.json()["api_key_masked"] == "sk-****7766"

    # 必密类型空串清空 → 422
    cleared = await client.patch(
        f"/api/v1/model-providers/{pid}", json={"api_key": ""}, headers=hdr
    )
    assert cleared.status_code == 422

    # 免密类型清空 → 200 置空
    ollama = (
        await _create_provider(
            client,
            token,
            org["id"],
            name="Ollama2",
            provider_type="ollama",
            base_url="https://1.2.3.4/v1",
            api_key="",
        )
    ).json()
    ok = await client.patch(
        f"/api/v1/model-providers/{ollama['id']}",
        json={"api_key": ""},
        headers=hdr,
    )
    assert ok.status_code == 200
    assert ok.json()["key_status"] == "empty"


@pytest.mark.asyncio
async def test_delete_cascades_models(client, engine):
    """删除供应商：模型清单级联清理；未被引用时可删除"""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import ProviderModel

    token = await _token(client, await _register(client, "p5@a.com", "p5"))
    org = await _create_org(client, token)
    body = (await _create_provider(client, token, org["id"])).json()
    resp = await client.delete(
        f"/api/v1/model-providers/{body['id']}", headers=_hdr(token, org["id"])
    )
    assert resp.status_code == 204
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        left = (
            await session.execute(
                select(ProviderModel).where(
                    ProviderModel.provider_id == body["id"]
                )
            )
        ).scalars().all()
        assert left == []


# ---------- 组织隔离与权限（D10） ----------


@pytest.mark.asyncio
async def test_cross_org_is_404_and_member_write_403(client):
    token = await _token(client, await _register(client, "p6@a.com", "p6"))
    org_a = await _create_org(client, token, "A")
    provider = (
        await _create_provider(client, token, org_a["id"], name="A供应")
    ).json()
    # 另一用户/组织不可见、不可删
    token_b = await _token(client, await _register(client, "p7@a.com", "p7"))
    org_b = await _create_org(client, token_b, "B")
    other = await client.get(
        f"/api/v1/model-providers/{provider['id']}", headers=_hdr(token_b, org_b["id"])
    )
    assert other.status_code == 404
    # member 只读：列表可见、写操作 403
    member_email = "m6@a.com"
    await _register(client, member_email, "m6")
    await client.post(
        f"/api/v1/organizations/{org_a['id']}/members",
        json={"email": member_email, "role": "member"},
        headers=_auth(token),
    )
    member_token = await _token(client, member_email)
    listed = await client.get(
        "/api/v1/model-providers", headers=_hdr(member_token, org_a["id"])
    )
    assert listed.status_code == 200
    denied = await client.post(
        "/api/v1/model-providers",
        json={
            "name": "X",
            "provider_type": "deepseek",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "sk-x-12345678",
        },
        headers=_hdr(member_token, org_a["id"]),
    )
    assert denied.status_code == 403


# ---------- 版本创建模型校验（D12） ----------


async def _disable_model(client, token, org_id, provider_id, model_id):
    return await client.patch(
        f"/api/v1/model-providers/{provider_id}/models/{model_id}",
        json={"enabled": False},
        headers=_hdr(token, org_id),
    )


async def _create_agent(client, token, org_id, **overrides):
    payload = {
        "name": overrides.pop("name", "助手"),
        "description": "d",
        "provider_id": overrides.pop("provider_id", None),
        "model_provider": overrides.pop("model_provider", "deepseek"),
        "model_name": overrides.pop("model_name", "deepseek-chat"),
        "system_prompt": "sp",
        **overrides,
    }
    return await client.post(
        "/api/v1/agents", json=payload, headers=_hdr(token, org_id)
    )


@pytest.mark.asyncio
async def test_version_binding_rules(client):
    """D12：禁用模型 422 / 未登记模型放行 / 跨组织供应商 404 / 快照与 provider_id 落库"""
    token = await _token(client, await _register(client, "p8@a.com", "p8"))
    org = await _create_org(client, token)
    provider = (
        await _create_provider(client, token, org["id"], name="D12供应")
    ).json()
    # hdr = _hdr(token, org["id"])

    # 禁用模型 → 422
    model_id = provider["models"][0]["id"]
    await _disable_model(client, token, org["id"], provider["id"], model_id)
    disabled_key = provider["models"][0]["model_key"]
    bad = await _create_agent(
        client, token, org["id"], provider_id=provider["id"], model_name=disabled_key
    )
    assert bad.status_code == 422
    assert bad.json()["code"] == "MODEL_PROVIDER_MODEL_DISABLED"

    # 未登记模型 → 放行（自定义兜底），快照 = 供应商名
    custom = await _create_agent(
        client,
        token,
        org["id"],
        name="自定义",
        provider_id=provider["id"],
        model_name="my-custom-model",
        model_provider="ignored-on-bind",
    )
    assert custom.status_code == 201, custom.text
    v1 = custom.json()["current_version_detail"]
    assert v1["provider_id"] == provider["id"]
    assert v1["model_provider"] == "D12供应"

    # 跨组织供应商 → 404 防泄漏
    token_b = await _token(client, await _register(client, "p9@a.com", "p9"))
    org_b = await _create_org(client, token_b, "B2")
    leak = await client.post(
        "/api/v1/agents",
        json={
            "name": "泄漏尝试",
            "provider_id": provider["id"],
            "model_provider": "x",
            "model_name": "deepseek-chat",
            "system_prompt": "s",
        },
        headers=_hdr(token_b, org_b["id"]),
    )
    assert leak.status_code == 404
    assert leak.json()["code"] == "MODEL_PROVIDER_NOT_FOUND"


# ---------- 引用删除保护（D7） ----------


@pytest.mark.asyncio
async def test_delete_referenced_provider_409(client):
    token = await _token(client, await _register(client, "pa@a.com", "pa"))
    org = await _create_org(client, token)
    provider = (
        await _create_provider(client, token, org["id"], name="被引用")
    ).json()
    agent = await _create_agent(
        client, token, org["id"], provider_id=provider["id"]
    )
    assert agent.status_code == 201
    resp = await client.delete(
        f"/api/v1/model-providers/{provider['id']}", headers=_hdr(token, org["id"])
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "MODEL_PROVIDER_IN_USE"
    # 供应商仍在
    still = await client.get(
        f"/api/v1/model-providers/{provider['id']}", headers=_hdr(token, org["id"])
    )
    assert still.status_code == 200


# ---------- SSRF 防护（D6） ----------


@pytest.mark.asyncio
async def test_ssrf_private_addresses_rejected(client, monkeypatch):
    """默认策略：内网/环回/云元数据地址一律 400"""
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_PROVIDER_URL", False)
    token = await _token(client, await _register(client, "pb@a.com", "pb"))
    org = await _create_org(client, token)
    for url in (
        "http://127.0.0.1:11434/v1",
        "http://169.254.169.254/latest/meta-data",
        "https://192.168.1.1/v1",
        "http://10.0.0.5/v1",
    ):
        resp = await _create_provider(
            client,
            token,
            org["id"],
            name=f"bad-{url}",
            provider_type="ollama",
            base_url=url,
            api_key="",
        )
        assert resp.status_code == 400, url
        assert resp.json()["code"] == "MODEL_PROVIDER_URL_FORBIDDEN"


@pytest.mark.asyncio
async def test_ssrf_allow_private_switch(client, monkeypatch):
    """ALLOW_PRIVATE_PROVIDER_URL=true：http/内网放行（自建 Ollama 场景）"""
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_PROVIDER_URL", True)
    token = await _token(client, await _register(client, "pc@a.com", "pc"))
    org = await _create_org(client, token)
    resp = await _create_provider(
        client,
        token,
        org["id"],
        name="本机",
        provider_type="ollama",
        base_url="http://127.0.0.1:11434/v1",
        api_key="",
    )
    assert resp.status_code == 201, resp.text


# ---------- 测试连接（D13） ----------


class _FakeResp:
    def __init__(self, status_code):
        self.status_code = status_code


class _FakeAsyncClient:
    status_code = 200

    def __init__(self, **kwargs):
        self.calls=[]
        

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None, **kwargs):
        _FakeAsyncClient.calls.append(("GET", url, headers))
        return _FakeResp(_FakeAsyncClient.status_code)

    async def post(self, url, headers=None, json=None, **kwargs):
        _FakeAsyncClient.calls.append(("POST", url, json, headers))
        return _FakeResp(_FakeAsyncClient.status_code)


@pytest.mark.asyncio
async def test_test_connection_modes_and_errors(client, monkeypatch):
    """D13 两模式 + error_type 映射；失败不抛 HTTP 错误"""
    import app.services.provider_service as ps_module

    token = await _token(client, await _register(client, "pd@a.com", "pd"))
    org = await _create_org(client, token)
    hdr = _hdr(token, org["id"])

    def _post(url, status):
        monkeypatch.setattr(_FakeAsyncClient, "status_code", status)
        return client.post(
            "/api/v1/model-providers/test-connection", json=url, headers=hdr
        )

    monkeypatch.setattr(ps_module.httpx, "AsyncClient", _FakeAsyncClient)

    # 模式一：无 model_key → GET /models
    _FakeAsyncClient.calls = []
    resp = (await _post({"base_url": "https://api.deepseek.com/v1",
                         "api_key": "sk-x-12345678"}, 200)).json()
    assert resp["ok"] is True
    assert _FakeAsyncClient.calls[0][1] == "https://api.deepseek.com/v1/models"

    # 模式二：有 model_key → POST chat/completions，max_tokens=1
    _FakeAsyncClient.calls = []
    resp = (await _post({"base_url": "https://api.deepseek.com/v1",
                         "api_key": "sk-x-12345678",
                         "model_key": "deepseek-chat",
                         "provider_type": "deepseek"}, 200)).json()
    assert resp["ok"] is True
    call = _FakeAsyncClient.calls[0]
    assert call[1].endswith("/chat/completions")
    assert call[2]["max_tokens"] == 1

    # 401 → auth；404（带模型）→ model_not_found；500 → unknown；网络异常 → network
    assert (await _post({"base_url": "https://1.2.3.4/v1",
                         "api_key": "sk-x-12345678"}, 401)).json()["error_type"] == "auth"
    body_404 = (await _post({"base_url": "https://1.2.3.4/v1",
                             "api_key": "sk-x-12345678",
                             "model_key": "nope",
                             "provider_type": "deepseek"}, 404)).json()
    assert body_404["error_type"] == "model_not_found"
    assert (await _post({"base_url": "https://1.2.3.4/v1",
                         "api_key": "sk-x-12345678"}, 500)).json()["error_type"] == "unknown"

    monkeypatch.setattr(
        ps_module.httpx, "AsyncClient", _RaisingClient
    )
    net = await client.post(
        "/api/v1/model-providers/test-connection",
        json={"base_url": "https://1.2.3.4/v1", "api_key": "sk-x-12345678"},
        headers=hdr,
    )
    assert net.status_code == 200
    assert net.json()["error_type"] == "network"

    # SSRF 拒绝 → forbidden（不抛 400）
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_PROVIDER_URL", False)
    forbidden = await client.post(
        "/api/v1/model-providers/test-connection",
        json={"base_url": "http://127.0.0.1:11434/v1"},
        headers=hdr,
    )
    assert forbidden.status_code == 200
    assert forbidden.json()["error_type"] == "forbidden"


class _RaisingClient:
    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        raise ConnectionError("boom")

    async def __aexit__(self, *args):
        return False


# ---------- 加密密钥缺失（D14） ----------


@pytest.mark.asyncio
async def test_encryption_key_missing_blocks_create(client, monkeypatch):
    """ENCRYPTION_KEY 未配置：建供应商（带 key）500；免密供应商不受影响"""
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")
    token = await _token(client, await _register(client, "pe@a.com", "pe"))
    org = await _create_org(client, token)
    blocked = await _create_provider(client, token, org["id"], name="有钥")
    assert blocked.status_code == 500
    assert blocked.json()["code"] == "ENCRYPTION_KEY_MISSING"
    ok = await _create_provider(
        client,
        token,
        org["id"],
        name="无钥",
        provider_type="ollama",
        base_url="https://1.2.3.4/v1",
        api_key="",
    )
    assert ok.status_code == 201
