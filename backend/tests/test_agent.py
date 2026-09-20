# tests/test_agent.py
# agent 接口集成测试：覆盖请求头组织隔离 / 创建(v1 自动发布) / 列表 / 权限矩阵 / 版本发布回滚 / 删除 / 解散联动
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
    resp = await client.post(
        "/api/v1/organizations", json={"name": name}, headers=_auth(token)
    )
    return resp.json()


async def _create_agent(client, token, org_id, name="客服助手", **overrides):
    payload = {
        "name": name,
        "model_provider": "openai",
        "model_name": "gpt-4o-mini",
        **overrides,
    }
    return await client.post(
        "/api/v1/agents", json=payload, headers=_hdr(token, org_id)
    )


# ---------- 创建与列表 ----------


async def test_create_agent_with_v1(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    resp = await _create_agent(
        client,
        token,
        org["id"],
        description="处理客户咨询",
        avatar_url="https://example.com/a.png",
        system_prompt="你是一名客服。",
        temperature=0.7,
        max_tokens=2048,
    )
    assert resp.status_code == 201
    agent = resp.json()
    assert agent["name"] == "客服助手"
    assert agent["status"] == "enabled"
    assert agent["avatar_url"] == "https://example.com/a.png"
    assert agent["created_by_username"] == "alice"
    # 初始配置自动生成 v1 并发布
    assert agent["current_version"] == 1
    detail = agent["current_version_detail"]
    assert detail["system_prompt"] == "你是一名客服。"
    assert detail["model_provider"] == "openai"
    assert detail["model_name"] == "gpt-4o-mini"
    assert detail["temperature"] == 0.7
    assert detail["max_tokens"] == 2048
    assert agent["created_at"] is not None

    lst = await client.get("/api/v1/agents", headers=_hdr(token, org["id"]))
    assert lst.status_code == 200
    item = lst.json()[0]
    assert item["name"] == "客服助手"
    assert item["current_version"] == 1

    detail_resp = await client.get(
        f"/api/v1/agents/{agent['id']}", headers=_hdr(token, org["id"])
    )
    assert detail_resp.status_code == 200
    assert (
        detail_resp.json()["current_version_detail"]["system_prompt"]
        == "你是一名客服。"
    )


async def test_create_agent_validation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    assert (
        await client.post(
            "/api/v1/agents",
            json={"name": "", "model_provider": "x", "model_name": "y"},
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/agents",
            json={"name": "x" * 101, "model_provider": "x", "model_name": "y"},
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/agents",
            json={
                "name": "a",
                "model_provider": "x",
                "model_name": "y",
                "temperature": 3,
            },
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/agents",
            json={
                "name": "a",
                "model_provider": "x",
                "model_name": "y",
                "max_tokens": 0,
            },
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422
    # 缺 model_name
    assert (
        await client.post(
            "/api/v1/agents",
            json={"name": "a", "model_provider": "x"},
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422
    # 非法状态
    assert (
        await client.post(
            "/api/v1/agents",
            json={
                "name": "a",
                "model_provider": "x",
                "model_name": "y",
                "status": "paused",
            },
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422


async def test_agent_name_conflict(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    assert (await _create_agent(client, token, org["id"])).status_code == 201
    resp = await _create_agent(client, token, org["id"])
    assert resp.status_code == 409
    assert resp.json()["code"] == "AGENT_NAME_CONFLICT"

    # 改名撞名 409；改名为自身原名 200
    second = (await _create_agent(client, token, org["id"], name="翻译助手")).json()
    resp = await client.patch(
        f"/api/v1/agents/{second['id']}",
        json={"name": "客服助手"},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 409
    resp = await client.patch(
        f"/api/v1/agents/{second['id']}",
        json={"name": "翻译助手"},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 200


async def test_agent_list_filters(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    await _create_agent(client, token, org["id"], name="客服助手")
    helper = (await _create_agent(client, token, org["id"], name="数据助手")).json()

    resp = await client.get(
        "/api/v1/agents", params={"name": "客服"}, headers=_hdr(token, org["id"])
    )
    assert [a["name"] for a in resp.json()] == ["客服助手"]

    await client.patch(
        f"/api/v1/agents/{helper['id']}/status",
        json={"status": "disabled"},
        headers=_hdr(token, org["id"]),
    )
    resp = await client.get(
        "/api/v1/agents", params={"status": "disabled"}, headers=_hdr(token, org["id"])
    )
    assert [a["name"] for a in resp.json()] == ["数据助手"]

    assert (
        await client.get(
            "/api/v1/agents",
            params={"status": "paused"},
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 422


async def test_agent_requires_auth(client):
    assert (await client.get("/api/v1/agents")).status_code == 401
    assert (await client.post("/api/v1/agents", json={"name": "x"})).status_code == 401


# ---------- 请求头组织隔离与权限 ----------


async def test_header_isolation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    # 缺失请求头 → 403
    resp = await client.get("/api/v1/agents", headers=_auth(token))
    assert resp.status_code == 403
    assert resp.json()["code"] == "FORBIDDEN"
    # 非数字请求头 → 403
    assert (
        await client.get(
            "/api/v1/agents",
            headers={"Authorization": f"Bearer {token}", "X-Organization-Id": "abc"},
        )
    ).status_code == 403
    # 组织不存在 → 404
    resp = await client.get("/api/v1/agents", headers=_hdr(token, 999999))
    assert resp.status_code == 404
    assert resp.json()["code"] == "ORGANIZATION_NOT_FOUND"
    # 非成员 → 403 NOT_ORG_MEMBER
    await _register(client, "bob@test.com", "bob")
    bob_token = await _token(client, "bob@test.com")
    resp = await client.get("/api/v1/agents", headers=_hdr(bob_token, org["id"]))
    assert resp.status_code == 403
    assert resp.json()["code"] == "NOT_ORG_MEMBER"


async def test_cross_org_agent_hidden(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice_token)
    org_b = await _create_org(client, bob_token, name="BobOrg")
    agent_a = (await _create_agent(client, alice_token, org_a["id"])).json()

    # 用 bob 的组织上下文访问 alice 的 agent → 404（不泄露存在性）
    resp = await client.get(
        f"/api/v1/agents/{agent_a['id']}", headers=_hdr(bob_token, org_b["id"])
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_NOT_FOUND"

    # 不存在 id → 404
    resp = await client.get(
        "/api/v1/agents/999999", headers=_hdr(alice_token, org_a["id"])
    )
    assert resp.status_code == 404


async def test_viewer_readonly(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "carol@test.com", "carol")
    alice_token = await _token(client, "alice@test.com")
    carol_token = await _token(client, "carol@test.com")
    org = await _create_org(client, alice_token)
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "carol@test.com", "role": "viewer"},
        headers=_auth(alice_token),
    )
    agent = (await _create_agent(client, alice_token, org["id"])).json()
    hdr = _hdr(carol_token, org["id"])

    # viewer 只读
    assert (await client.get("/api/v1/agents", headers=hdr)).status_code == 200
    assert (
        await client.get(f"/api/v1/agents/{agent['id']}", headers=hdr)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/agents/{agent['id']}/versions", headers=hdr)
    ).status_code == 200
    # viewer 管理操作全部 403
    assert (
        await client.post(
            "/api/v1/agents",
            json={"name": "x", "model_provider": "x", "model_name": "y"},
            headers=hdr,
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/agents/{agent['id']}", json={"name": "y"}, headers=hdr
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/agents/{agent['id']}/status",
            json={"status": "disabled"},
            headers=hdr,
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/agents/{agent['id']}/versions",
            json={"model_provider": "x", "model_name": "y"},
            headers=hdr,
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/agents/{agent['id']}/versions/1/publish", headers=hdr
        )
    ).status_code == 403
    assert (
        await client.delete(f"/api/v1/agents/{agent['id']}", headers=hdr)
    ).status_code == 403


# ---------- 基础信息编辑 / 启停 / 删除 ----------


async def test_update_agent_basic_fields(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (await _create_agent(client, token, org["id"])).json()
    url = f"/api/v1/agents/{agent['id']}"
    hdr = _hdr(token, org["id"])

    resp = await client.patch(
        url,
        json={"description": "新描述", "avatar_url": "https://example.com/b.png"},
        headers=hdr,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["description"] == "新描述"
    assert body["avatar_url"] == "https://example.com/b.png"
    # 基础信息编辑不影响版本配置
    assert body["current_version"] == 1

    # 可空字段传 null 清空
    resp = await client.patch(
        url, json={"description": None, "avatar_url": None}, headers=hdr
    )
    assert resp.status_code == 200
    assert resp.json()["description"] is None
    assert resp.json()["avatar_url"] is None

    # 名称必填，显式 null → 422
    resp = await client.patch(url, json={"name": None}, headers=hdr)
    assert resp.status_code == 422
    assert resp.json()["code"] == "AGENT_FIELD_REQUIRED"


async def test_set_status(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (await _create_agent(client, token, org["id"])).json()
    url = f"/api/v1/agents/{agent['id']}/status"
    hdr = _hdr(token, org["id"])

    resp = await client.patch(url, json={"status": "disabled"}, headers=hdr)
    assert resp.status_code == 200
    assert resp.json()["status"] == "disabled"
    resp = await client.patch(url, json={"status": "enabled"}, headers=hdr)
    assert resp.json()["status"] == "enabled"
    assert (
        await client.patch(url, json={"status": "paused"}, headers=hdr)
    ).status_code == 422


async def test_delete_agent(client, db):
    from sqlalchemy import func, select

    from app.models import AgentVersion

    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (await _create_agent(client, token, org["id"])).json()
    hdr = _hdr(token, org["id"])

    resp = await client.delete(f"/api/v1/agents/{agent['id']}", headers=hdr)
    assert resp.status_code == 204
    assert (await client.get("/api/v1/agents", headers=hdr)).json() == []
    assert (
        await client.get(f"/api/v1/agents/{agent['id']}", headers=hdr)
    ).status_code == 404

    # 版本随外键级联清理
    result = await db.execute(
        select(func.count(AgentVersion.id)).where(AgentVersion.agent_id == agent["id"])
    )
    assert result.scalar_one() == 0


# ---------- 版本管理（需求 3.4） ----------


async def test_version_publish_rollback(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (await _create_agent(client, token, org["id"])).json()
    hdr = _hdr(token, org["id"])
    base = f"/api/v1/agents/{agent['id']}/versions"

    # 创建 v2（不自动发布）
    resp = await client.post(
        base,
        json={
            "system_prompt": "v2 提示词",
            "model_provider": "openai",
            "model_name": "gpt-4o",
        },
        headers=hdr,
    )
    assert resp.status_code == 201
    v2 = resp.json()
    assert v2["version"] == 2
    assert v2["created_by_username"] == "alice"

    # 版本列表（新版本在前）
    lst = await client.get(base, headers=hdr)
    assert [v["version"] for v in lst.json()] == [2, 1]

    # 创建后未发布：当前版本仍为 v1
    detail = await client.get(f"/api/v1/agents/{agent['id']}", headers=hdr)
    assert detail.json()["current_version"] == 1

    # 发布 v2
    resp = await client.post(f"{base}/{v2['id']}/publish", headers=hdr)
    assert resp.status_code == 200
    assert resp.json()["current_version"] == 2
    assert resp.json()["current_version_detail"]["model_name"] == "gpt-4o"

    # 回滚到 v1（v1 记录 id 取自创建响应，非自增主键 1）
    v1_id = agent["current_version_detail"]["id"]
    resp = await client.post(f"{base}/{v1_id}/rollback", headers=hdr)
    assert resp.status_code == 200
    assert resp.json()["current_version"] == 1

    # 版本不存在 → 404
    assert (await client.post(f"{base}/999999/publish", headers=hdr)).status_code == 404
    assert (
        await client.post(f"{base}/999999/rollback", headers=hdr)
    ).status_code == 404


async def test_version_not_found_and_cross_agent(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent_a = (await _create_agent(client, token, org["id"], name="甲")).json()
    agent_b = (await _create_agent(client, token, org["id"], name="乙")).json()
    hdr = _hdr(token, org["id"])

    # 用 B 的 agent_id 发布 A 的版本 → 404
    resp = await client.post(
        f"/api/v1/agents/{agent_b['id']}/versions/"
        f"{agent_a['current_version_detail']['id']}/publish",
        headers=hdr,
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_VERSION_NOT_FOUND"


async def test_dissolve_cascades_agents_and_versions(client, db):
    from sqlalchemy import func, select

    from app.models import Agent, AgentVersion

    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    await _create_agent(client, token, org["id"])

    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}", headers=_auth(token)
    )
    assert resp.status_code == 204

    result = await db.execute(
        select(func.count(Agent.id)).where(Agent.organization_id == org["id"])
    )
    assert result.scalar_one() == 0
    result = await db.execute(select(func.count(AgentVersion.id)))
    assert result.scalar_one() == 0
