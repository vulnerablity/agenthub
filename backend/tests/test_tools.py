# tests/test_tools.py
# 工具接口集成测试：CRUD / 组织隔离 / 名称冲突 / 校验 / 测试执行（calculator+http+SSRF）/ 绑定 / 权限矩阵 / 解散联动
from app.integrations import tool_runners as tool_runners_module
from app.schemas.tool import CALCULATOR_SCHEMA

PASSWORD = "secret123"


async def _register(client, email, username):
    return await client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": PASSWORD},
    )


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


async def _create_tool(client, token, org_id, name, type_, **overrides):
    if type_ == "calculator":
        payload = {
            "name": name,
            "type": "calculator",
            "schema": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
        }
    else:
        payload = {
            "name": name,
            "type": "http",
            "schema": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
            },
            "config": {"url": "https://example.com/api"},
        }
    payload.update(overrides)
    return await client.post("/api/v1/tools", json=payload, headers=_hdr(token, org_id))


async def _create_agent(client, token, org_id, name="客服助手", **overrides):
    payload = {
        "name": name,
        "model_provider": "openai",
        "model_name": "gpt-4o-mini",
        **overrides,
    }
    return (
        await client.post("/api/v1/agents", json=payload, headers=_hdr(token, org_id))
    ).json()


# ---------- 创建与校验 ----------


async def test_create_calculator_normalizes(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    # calculator：schema/config 强制规约（D06）——无论传入什么，schema 固定、config 置 null
    resp = await _create_tool(
        client,
        token,
        org["id"],
        "计算器",
        "calculator",
        description="四则运算",
        config={"whatever": 1},
        schema={"type": "object"},
    )
    assert resp.status_code == 201
    tool = resp.json()
    assert tool["type"] == "calculator"
    assert tool["schema"] == CALCULATOR_SCHEMA
    assert tool["config"] is None
    assert tool["status"] == "active"


async def test_create_http_tool(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    resp = await _create_tool(
        client,
        token,
        org["id"],
        "订单查询",
        "http",
        config={
            "url": "https://example.com/orders",
            "method": "POST",
            "headers": {"X-Token": "abc"},
        },
        schema={
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
            "required": ["order_id"],
        },
    )
    assert resp.status_code == 201
    tool = resp.json()
    assert tool["config"]["url"] == "https://example.com/orders"
    assert tool["config"]["method"] == "POST"


async def test_create_tool_validation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    # 未知 type → 422（pydantic Literal 拦截）
    resp = await client.post(
        "/api/v1/tools",
        json={"name": "坏类型", "type": "database", "schema": {"type": "object"}},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 422

    # schema 非 object → 422 TOOL_SCHEMA_INVALID
    resp = await _create_tool(
        client, token, org["id"], "坏Schema", "calculator", schema={"type": "string"}
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "TOOL_SCHEMA_INVALID"

    # http 缺 url → 422 TOOL_CONFIG_INVALID
    resp = await _create_tool(
        client, token, org["id"], "缺URL", "http", config={"method": "GET"}
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "TOOL_CONFIG_INVALID"

    # url 非 http/https → 422
    resp = await _create_tool(
        client, token, org["id"], "坏URL", "http", config={"url": "ftp://x.com"}
    )
    assert resp.status_code == 422

    # 名称冲突 → 409 TOOL_NAME_CONFLICT
    assert (
        await _create_tool(client, token, org["id"], "唯一名", "calculator")
    ).status_code == 201
    resp = await _create_tool(client, token, org["id"], "唯一名", "calculator")
    assert resp.status_code == 409
    assert resp.json()["code"] == "TOOL_NAME_CONFLICT"


# ---------- 列表 / 详情 / 更新 / 删除 ----------


async def test_tool_crud_lifecycle(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    t1 = (await _create_tool(client, token, org["id"], "甲", "calculator")).json()
    t2 = (await _create_tool(client, token, org["id"], "乙", "http")).json()

    lst = await client.get("/api/v1/tools", headers=_hdr(token, org["id"]))
    assert [t["id"] for t in lst.json()] == [t2["id"], t1["id"]]  # 最近更新在前

    detail = await client.get(
        f"/api/v1/tools/{t1['id']}", headers=_hdr(token, org["id"])
    )
    assert detail.json()["name"] == "甲"

    # 更新名称与描述
    resp = await client.patch(
        f"/api/v1/tools/{t1['id']}",
        json={"name": "甲改", "description": "新描述"},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "甲改"
    assert resp.json()["description"] == "新描述"

    # 删除
    resp = await client.delete(
        f"/api/v1/tools/{t2['id']}", headers=_hdr(token, org["id"])
    )
    assert resp.status_code == 204
    assert (
        await client.get(f"/api/v1/tools/{t2['id']}", headers=_hdr(token, org["id"]))
    ).status_code == 404

    # 不存在的工具 → 404 TOOL_NOT_FOUND
    resp = await client.get("/api/v1/tools/999999", headers=_hdr(token, org["id"]))
    assert resp.status_code == 404
    assert resp.json()["code"] == "TOOL_NOT_FOUND"


# ---------- 组织隔离与权限 ----------


async def test_org_isolation_and_permissions(client):
    await _register(client, "alice@test.com", "alice")
    bob_id = (await _register(client, "bob@test.com", "bob")).json()["id"]
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice, name="A")
    org_b = await _create_org(client, bob, name="B")

    tool = (
        await _create_tool(client, alice, org_a["id"], "私有工具", "calculator")
    ).json()

    # 跨组织访问 → 404（不泄露存在性，D12）
    resp = await client.get(
        f"/api/v1/tools/{tool['id']}", headers=_hdr(bob, org_b["id"])
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "TOOL_NOT_FOUND"

    # 无组织头 → 403
    resp = await client.get(f"/api/v1/tools/{tool['id']}", headers=_auth(bob))
    assert resp.status_code == 403

    # member/viewer 写操作 403；member 可读
    await client.post(
        f"/api/v1/organizations/{org_a['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice),
    )
    lst = await client.get("/api/v1/tools", headers=_hdr(bob, org_a["id"]))
    assert lst.status_code == 200
    resp = await _create_tool(client, bob, org_a["id"], "越权", "calculator")
    assert resp.status_code == 403

    await client.patch(
        f"/api/v1/organizations/{org_a['id']}/members/{bob_id}",
        json={"role": "viewer"},
        headers=_auth(alice),
    )
    resp = await _create_tool(client, bob, org_a["id"], "越权2", "calculator")
    assert resp.status_code == 403
    resp = await client.post(
        f"/api/v1/tools/{tool['id']}/test",
        json={"arguments": {"expression": "1+1"}},
        headers=_hdr(bob, org_a["id"]),
    )
    assert resp.status_code == 403


# ---------- 工具测试接口（需求 3.7） ----------


async def test_calculator_execution(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    tool = (await _create_tool(client, token, org["id"], "计算器", "calculator")).json()

    # 合法表达式
    for expr, expected in [("1+1", "2"), ("(2+3)*4", "20"), ("max(1,2,3)", "3")]:
        resp = await client.post(
            f"/api/v1/tools/{tool['id']}/test",
            json={"arguments": {"expression": expr}},
            headers=_hdr(token, org["id"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["output"] == expected
        assert body["duration_ms"] >= 0

    # 非法表达式：不抛异常，error 降级返回（D11）
    for expr in ["1/0", "__import__('os')", "open('/etc/passwd')", "[1,2,3]"]:
        resp = await client.post(
            f"/api/v1/tools/{tool['id']}/test",
            json={"arguments": {"expression": expr}},
            headers=_hdr(token, org["id"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "error"
        assert body["error"]


class _FakeResponse:
    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text


class _FakeHttpClient:
    """替身 httpx.AsyncClient：捕获请求（含 SSRF 前置拦截后不再触网）"""

    last_request: dict | None = None
    response = _FakeResponse(200, "ok body")

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def request(self, method, url, headers=None, content=None):
        _FakeHttpClient.last_request = {
            "method": method,
            "url": url,
            "headers": headers,
            "content": content,
        }
        return _FakeHttpClient.response


async def test_http_execution(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    tool = (
        await _create_tool(
            client,
            token,
            org["id"],
            "订单查询",
            "http",
            config={"url": "https://example.com/orders/{order_id}", "method": "GET"},
            schema={
                "type": "object",
                "properties": {"order_id": {"type": "string"}},
                "required": ["order_id"],
            },
        )
    ).json()

    monkeypatch.setattr(tool_runners_module.httpx, "AsyncClient", _FakeHttpClient)
    resp = await client.post(
        f"/api/v1/tools/{tool['id']}/test",
        json={"arguments": {"order_id": "ORD-1"}},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["output"] == "ok body"
    # 占位符注入 + method 生效（D06 桥接）
    assert _FakeHttpClient.last_request["url"] == "https://example.com/orders/ORD-1"
    assert _FakeHttpClient.last_request["method"] == "GET"

    # 上游 500 → error 降级
    _FakeHttpClient.response = _FakeResponse(500, "server boom")
    resp = await client.post(
        f"/api/v1/tools/{tool['id']}/test",
        json={"arguments": {"order_id": "ORD-2"}},
        headers=_hdr(token, org["id"]),
    )
    assert resp.json()["status"] == "error"
    assert "500" in resp.json()["output"] or "500" in (resp.json()["error"] or "")


async def test_http_ssrf_blocked(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    tool = (
        await _create_tool(
            client,
            token,
            org["id"],
            "内网探测",
            "http",
            config={"url": "http://127.0.0.1:8000/secret"},
        )
    ).json()

    resp = await client.post(
        f"/api/v1/tools/{tool['id']}/test",
        json={"arguments": {}},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert "不允许访问" in (body["output"] or body["error"] or "")


# ---------- Agent 绑定（需求 3.7 / 4.7） ----------


async def test_agent_tool_binding_lifecycle(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    tool = (await _create_tool(client, token, org["id"], "计算器", "calculator")).json()
    tool2 = (await _create_tool(client, token, org["id"], "订单", "http")).json()

    # 绑定
    resp = await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"]},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 201
    binding = resp.json()
    assert binding["tool_name"] == "计算器"
    assert binding["enabled"] is True
    assert binding["config_json"] is None

    # 重复绑定 → 409
    resp = await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"]},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "AGENT_TOOL_ALREADY_BOUND"

    # 列表
    lst = await client.get(
        f"/api/v1/agents/{agent['id']}/tools", headers=_hdr(token, org["id"])
    )
    assert [b["tool_id"] for b in lst.json()] == [tool["id"]]

    # 开关 + 绑定级 config 覆盖
    resp = await client.patch(
        f"/api/v1/agents/{agent['id']}/tools/{tool['id']}",
        json={"enabled": False, "config_json": {"url": "https://x.com"}},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["config_json"] == {"url": "https://x.com"}

    # 解绑
    resp = await client.delete(
        f"/api/v1/agents/{agent['id']}/tools/{tool['id']}",
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 204
    # 已解绑 → 404
    resp = await client.delete(
        f"/api/v1/agents/{agent['id']}/tools/{tool['id']}",
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_TOOL_NOT_FOUND"

    # 删除工具后绑定随 FK CASCADE（D04）
    assert (
        await client.post(
            f"/api/v1/agents/{agent['id']}/tools",
            json={"tool_id": tool2["id"]},
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 201
    await client.delete(f"/api/v1/tools/{tool2['id']}", headers=_hdr(token, org["id"]))
    lst = await client.get(
        f"/api/v1/agents/{agent['id']}/tools", headers=_hdr(token, org["id"])
    )
    assert lst.json() == []


async def test_binding_cross_org_and_agent(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice, name="A")
    org_b = await _create_org(client, bob, name="B")
    agent_a = await _create_agent(client, alice, org_a["id"])
    agent_b = await _create_agent(client, bob, org_b["id"], name="B助手")
    tool_a = (
        await _create_tool(client, alice, org_a["id"], "计算器", "calculator")
    ).json()

    # 跨组织 agent（路径资源先校验）→ 404 AGENT_NOT_FOUND（不泄露归属，D12）
    resp = await client.post(
        f"/api/v1/agents/{agent_a['id']}/tools",
        json={"tool_id": tool_a["id"]},
        headers=_hdr(bob, org_b["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_NOT_FOUND"

    # bob 自己的 Agent 绑定跨组织工具 → 404 TOOL_NOT_FOUND（工具归属不泄露）
    resp = await client.post(
        f"/api/v1/agents/{agent_b['id']}/tools",
        json={"tool_id": tool_a["id"]},
        headers=_hdr(bob, org_b["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "TOOL_NOT_FOUND"

    # 跨组织读取绑定列表 → 404 AGENT_NOT_FOUND
    resp = await client.get(
        f"/api/v1/agents/{agent_a['id']}/tools", headers=_hdr(bob, org_b["id"])
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_NOT_FOUND"

    # 绑定不存在的工具 → 404
    resp = await client.post(
        f"/api/v1/agents/{agent_a['id']}/tools",
        json={"tool_id": 999999},
        headers=_hdr(alice, org_a["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "TOOL_NOT_FOUND"


# ---------- 解散联动（tool-calling.md 2.8） ----------


async def test_dissolve_cleans_tools(client, db):
    from sqlalchemy import select

    from app.models import Tool

    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    tool = (await _create_tool(client, token, org["id"], "计算器", "calculator")).json()
    await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"]},
        headers=_hdr(token, org["id"]),
    )

    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}", headers=_hdr(token, org["id"])
    )
    assert resp.status_code == 204

    # 工具与绑定均被清理（agent_tools 先随 agents CASCADE，tools 由 service 显式删）
    remaining = (await db.execute(select(Tool.id))).scalars().all()
    assert remaining == []
