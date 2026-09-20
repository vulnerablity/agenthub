# tests/test_agent.py
# agent 接口集成测试：覆盖创建 / 列表过滤 / 权限矩阵 / 归属隔离 / 编辑 / 启停 / 删除 / 组织解散联动
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


async def _create_org(client, token, name="Acme"):
    resp = await client.post(
        "/api/v1/organizations", json={"name": name}, headers=_auth(token)
    )
    return resp.json()


async def _create_agent(client, token, org_id, name="客服助手", **overrides):
    payload = {"name": name, "provider": "openai", "model": "gpt-4o-mini", **overrides}
    return await client.post(
        f"/api/v1/organizations/{org_id}/agents", json=payload, headers=_auth(token)
    )


# ---------- 创建与列表 ----------


async def test_create_agent_and_list(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    resp = await _create_agent(
        client,
        token,
        org["id"],
        description="处理客户咨询",
        system_prompt="你是一名客服。",
        temperature=0.7,
        max_tokens=2048,
    )
    assert resp.status_code == 201
    agent = resp.json()
    assert agent["name"] == "客服助手"
    assert agent["status"] == "enabled"
    assert agent["provider"] == "openai"
    assert agent["model"] == "gpt-4o-mini"
    assert agent["temperature"] == 0.7
    assert agent["max_tokens"] == 2048
    assert agent["created_by_username"] == "alice"
    assert agent["created_at"] is not None

    lst = await client.get(
        f"/api/v1/organizations/{org['id']}/agents", headers=_auth(token)
    )
    assert lst.status_code == 200
    assert len(lst.json()) == 1
    item = lst.json()[0]
    assert item["name"] == "客服助手"
    assert item["status"] == "enabled"

    detail = await client.get(
        f"/api/v1/organizations/{org['id']}/agents/{agent['id']}",
        headers=_auth(token),
    )
    assert detail.status_code == 200
    assert detail.json()["system_prompt"] == "你是一名客服。"


async def test_create_agent_validation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    url = f"/api/v1/organizations/{org['id']}/agents"

    assert (
        await client.post(
            url, json={"name": "", "provider": "x", "model": "y"}, headers=_auth(token)
        )
    ).status_code == 422
    assert (
        await client.post(
            url,
            json={"name": "x" * 101, "provider": "x", "model": "y"},
            headers=_auth(token),
        )
    ).status_code == 422
    # temperature 越界 / max_tokens 越界 / 缺少 provider
    assert (
        await client.post(
            url,
            json={"name": "a", "provider": "x", "model": "y", "temperature": 3},
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            url,
            json={"name": "a", "provider": "x", "model": "y", "max_tokens": 0},
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(url, json={"name": "a", "model": "y"}, headers=_auth(token))
    ).status_code == 422


async def test_agent_name_conflict(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    assert (await _create_agent(client, token, org["id"])).status_code == 201
    resp = await _create_agent(client, token, org["id"])
    assert resp.status_code == 409
    assert resp.json()["code"] == "AGENT_NAME_CONFLICT"

    # 改名撞已有名称
    second = (await _create_agent(client, token, org["id"], name="翻译助手")).json()
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/agents/{second['id']}",
        json={"name": "客服助手"},
        headers=_auth(token),
    )
    assert resp.status_code == 409

    # 改名为自身原名不冲突
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/agents/{second['id']}",
        json={"name": "翻译助手"},
        headers=_auth(token),
    )
    assert resp.status_code == 200


async def test_agent_list_filters(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    await _create_agent(client, token, org["id"], name="客服助手")
    data_assistant = (
        await _create_agent(client, token, org["id"], name="数据助手")
    ).json()
    url = f"/api/v1/organizations/{org['id']}/agents"

    # 名称模糊过滤
    resp = await client.get(url, params={"name": "客服"}, headers=_auth(token))
    assert [a["name"] for a in resp.json()] == ["客服助手"]

    # 状态过滤（先停用数据助手）
    await client.patch(
        f"{url}/{data_assistant['id']}/status",
        json={"status": "disabled"},
        headers=_auth(token),
    )
    resp = await client.get(url, params={"status": "disabled"}, headers=_auth(token))
    assert [a["name"] for a in resp.json()] == ["数据助手"]

    # 非法状态值
    assert (
        await client.get(url, params={"status": "paused"}, headers=_auth(token))
    ).status_code == 422


async def test_agent_requires_auth(client):
    assert (await client.get("/api/v1/organizations/1/agents")).status_code == 401
    assert (
        await client.post("/api/v1/organizations/1/agents", json={"name": "x"})
    ).status_code == 401


# ---------- 权限与归属隔离 ----------


async def test_non_member_forbidden(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = await _create_org(client, bob_token)

    resp = await client.get(
        f"/api/v1/organizations/{org['id']}/agents", headers=_auth(alice_token)
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "NOT_ORG_MEMBER"


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
    url = f"/api/v1/organizations/{org['id']}/agents"

    # viewer 只读
    assert (await client.get(url, headers=_auth(carol_token))).status_code == 200
    assert (
        await client.get(f"{url}/{agent['id']}", headers=_auth(carol_token))
    ).status_code == 200
    # viewer 管理操作全部 403
    assert (
        await client.post(
            url,
            json={"name": "x", "provider": "x", "model": "y"},
            headers=_auth(carol_token),
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"{url}/{agent['id']}", json={"name": "y"}, headers=_auth(carol_token)
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"{url}/{agent['id']}/status",
            json={"status": "disabled"},
            headers=_auth(carol_token),
        )
    ).status_code == 403
    assert (
        await client.delete(f"{url}/{agent['id']}", headers=_auth(carol_token))
    ).status_code == 403


async def test_agent_not_found_and_ownership(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice_token)
    org_b = await _create_org(client, bob_token, name="BobOrg")
    agent_a = (await _create_agent(client, alice_token, org_a["id"])).json()

    # 不存在的智能体
    resp = await client.get(
        f"/api/v1/organizations/{org_a['id']}/agents/999999", headers=_auth(alice_token)
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_NOT_FOUND"

    # 他组织成员通过自己组织访问我的智能体 → 404（不泄露存在性）
    resp = await client.get(
        f"/api/v1/organizations/{org_b['id']}/agents/{agent_a['id']}",
        headers=_auth(bob_token),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_NOT_FOUND"

    # 同组织内路径带他组织 agent_id → 404
    resp = await client.get(
        f"/api/v1/organizations/{org_a['id']}/agents/{agent_a['id']}",
        headers=_auth(alice_token),
    )
    assert resp.status_code == 200


# ---------- 编辑 / 启停 / 删除 ----------


async def test_update_agent(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (
        await _create_agent(client, token, org["id"], temperature=0.5, max_tokens=1024)
    ).json()
    url = f"/api/v1/organizations/{org['id']}/agents/{agent['id']}"

    # 局部更新：只改 model 与 system_prompt，其余不动
    resp = await client.patch(
        url,
        json={"model": "gpt-4o", "system_prompt": "新的提示词"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["model"] == "gpt-4o"
    assert body["temperature"] == 0.5
    assert body["max_tokens"] == 1024
    assert body["system_prompt"] == "新的提示词"

    # 可空字段传 null 表示清空；system_prompt 清空回退空串
    resp = await client.patch(
        url,
        json={"description": None, "temperature": None, "system_prompt": None},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["description"] is None
    assert body["temperature"] is None
    assert body["system_prompt"] == ""

    # 必填字段显式传 null → 422
    resp = await client.patch(url, json={"name": None}, headers=_auth(token))
    assert resp.status_code == 422
    assert resp.json()["code"] == "AGENT_FIELD_REQUIRED"
    resp = await client.patch(url, json={"provider": None}, headers=_auth(token))
    assert resp.status_code == 422

    # 空请求体：所有值保持不变
    resp = await client.patch(url, json={}, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["model"] == "gpt-4o"


async def test_set_status(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (await _create_agent(client, token, org["id"])).json()
    url = f"/api/v1/organizations/{org['id']}/agents/{agent['id']}/status"

    resp = await client.patch(url, json={"status": "disabled"}, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "disabled"

    resp = await client.patch(url, json={"status": "enabled"}, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "enabled"

    assert (
        await client.patch(url, json={"status": "paused"}, headers=_auth(token))
    ).status_code == 422


async def test_delete_agent(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = (await _create_agent(client, token, org["id"])).json()
    url = f"/api/v1/organizations/{org['id']}/agents"

    resp = await client.delete(f"{url}/{agent['id']}", headers=_auth(token))
    assert resp.status_code == 204
    assert (await client.get(url, headers=_auth(token))).json() == []
    assert (
        await client.get(f"{url}/{agent['id']}", headers=_auth(token))
    ).status_code == 404


# ---------- 组织解散联动（D8） ----------


async def test_dissolve_cascades_agents(client, db):
    from sqlalchemy import func, select

    from app.models import Agent

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
