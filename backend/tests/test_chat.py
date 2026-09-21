# tests/test_chat.py
# 对话接口集成测试：覆盖组织隔离(D12) / 用户私有(D1) / 版本快照(D6) / SSE 协议 / 并发互斥(D11) / 空输出(D13) / 同步发送 / 删除级联
import asyncio
import json

from sqlalchemy import select

from app.core.exceptions import LLMUpstreamError
from app.integrations import llm as llm_module
from app.models import Organization, User
from app.schemas.chat import MessageCreateRequest
from app.services.chat_service import ChatService

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


async def _create_agent(client, token, org_id, name="客服助手", **overrides):
    payload = {
        "name": name,
        "model_provider": "openai",
        "model_name": "gpt-4o-mini",
        **overrides,
    }
    return (
        await client.post(
            "/api/v1/agents", json=payload, headers=_hdr(token, org_id)
        )
    ).json()


async def _create_conversation(client, token, org_id, agent_id, title=None):
    payload = {"agent_id": agent_id}
    if title is not None:
        payload["title"] = title
    return await client.post(
        "/api/v1/conversations", json=payload, headers=_hdr(token, org_id)
    )


def _fake_chat(deltas, usage=None, error_after=None, blocker=None, captured=None):
    """构造假 LLM 流：按序产出 delta；可选阻塞（并发测试）/ 流中抛错 / 捕获上下文参数"""

    async def chat_stream(self, *, messages, model, temperature=None, max_tokens=None):
        if captured is not None:
            captured.append({"messages": messages, "model": model})
        for delta in deltas:
            yield {"delta": delta}
        if blocker is not None:
            await blocker.wait()
        if error_after is not None:
            raise error_after
        yield {
            "usage": usage
            or {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}
        }

    return chat_stream


async def _read_sse(resp):
    """解析 SSE 响应为 (event, data) 列表"""
    events: list[tuple[str | None, dict]] = []
    current: str | None = None
    async for line in resp.aiter_lines():
        if line.startswith("event:"):
            current = line[len("event:") :].strip()
        elif line.startswith("data:"):
            events.append((current, json.loads(line[len("data:") :].strip())))
            current = None
    return events


# ---------- 创建会话 ----------


async def test_create_conversation_snapshots_version(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"], system_prompt="你是客服")

    resp = await _create_conversation(client, token, org["id"], agent["id"])
    assert resp.status_code == 201
    conv = resp.json()
    assert conv["title"] == "新对话"
    assert conv["agent_name"] == "客服助手"
    # 版本快照：绑定创建时的当前发布版本 v1（chat.md D6）
    assert conv["agent_version_id"] == agent["current_version_detail"]["id"]


async def test_create_conversation_validation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    org_b = await _create_org(client, token, name="Beta")
    agent = await _create_agent(client, token, org["id"])

    # 无组织头 → 403（不泄露组织存在性）
    resp = await client.post(
        "/api/v1/conversations",
        json={"agent_id": agent["id"]},
        headers=_auth(token),
    )
    assert resp.status_code == 403

    # 跨组织引用 Agent → 404
    resp = await _create_conversation(client, token, org_b["id"], agent["id"])
    assert resp.status_code == 404
    assert resp.json()["code"] == "AGENT_NOT_FOUND"

    # Agent 禁用 → 409
    await client.patch(
        f"/api/v1/agents/{agent['id']}/status",
        json={"status": "disabled"},
        headers=_hdr(token, org["id"]),
    )
    resp = await _create_conversation(client, token, org["id"], agent["id"])
    assert resp.status_code == 409
    assert resp.json()["code"] == "AGENT_NOT_AVAILABLE"


# ---------- 组织隔离与用户私有 ----------


async def test_org_isolation_and_private(client, monkeypatch):
    # alice 属两个组织；bob 与 alice 同属 Org A
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice, name="A")
    org_b = await _create_org(client, alice, name="B")
    agent_a = await _create_agent(client, alice, org_a["id"], name="A助手")
    agent_b = await _create_agent(client, alice, org_b["id"], name="B助手")
    await client.post(
        f"/api/v1/organizations/{org_a['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice),
    )

    conv_a = (await _create_conversation(client, alice, org_a["id"], agent_a["id"])).json()
    conv_b = (await _create_conversation(client, alice, org_b["id"], agent_b["id"])).json()

    # 列表按请求头组织过滤（chat.md D12）
    lst_a = await client.get("/api/v1/conversations", headers=_hdr(alice, org_a["id"]))
    assert [c["id"] for c in lst_a.json()] == [conv_a["id"]]
    lst_b = await client.get("/api/v1/conversations", headers=_hdr(alice, org_b["id"]))
    assert [c["id"] for c in lst_b.json()] == [conv_b["id"]]

    # 跨组织直访会话 → 404
    resp = await client.get(
        f"/api/v1/conversations/{conv_a['id']}", headers=_hdr(alice, org_b["id"])
    )
    assert resp.status_code == 404

    # 同组织他人访问（用户私有，chat.md D1）→ 404，列表亦不可见
    resp = await client.get(
        f"/api/v1/conversations/{conv_a['id']}", headers=_hdr(bob, org_a["id"])
    )
    assert resp.status_code == 404
    lst_bob = await client.get("/api/v1/conversations", headers=_hdr(bob, org_a["id"]))
    assert lst_bob.json() == []


# ---------- SSE 流式 ----------


async def test_stream_success_persists(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_chat(["你好", "，世界"], usage={"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "你好啊"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        events = await _read_sse(resp)

    assert [e for e, _ in events if e is not None] == ["message", "message", "done"]
    assert [d for e, d in events if e == "message"] == [
        {"delta": "你好"},
        {"delta": "，世界"},
    ]
    done = next(d for e, d in events if e == "done")
    assert done["message_id"] is not None
    assert done["token_usage"]["total_tokens"] == 12

    # 落库：用户消息 + 助手消息（含 token_usage 与模型元信息）
    messages = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "你好啊"
    assert messages[1]["content"] == "你好，世界"
    assert messages[1]["token_usage"]["total_tokens"] == 12
    assert messages[1]["metadata_json"]["model_name"] == "gpt-4o-mini"

    # 首轮自动更新标题（chat.md D2）
    detail = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}", headers=_hdr(token, org["id"])
        )
    ).json()
    assert detail["title"] == "你好啊"


async def test_stream_midway_error(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_chat(["部分回答"], error_after=LLMUpstreamError()),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "提问"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    kinds = [e for e, _ in events if e is not None]
    assert "message" in kinds and kinds[-1] == "error"
    err = next(d for e, d in events if e == "error")
    assert err["code"] == "LLM_UPSTREAM_ERROR"

    # 用户消息已落库（可重试），助手消息不落库（chat.md D5）
    messages = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [m["role"] for m in messages] == ["user"]


async def test_stream_empty_output(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat([]))
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "提问"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    done = next(d for e, d in events if e == "done")
    assert done == {"message_id": None, "token_usage": None}
    messages = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [m["role"] for m in messages] == ["user"]


async def test_stream_concurrent_busy(client, db, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["回答"]))
    url = f"/api/v1/conversations/{conv['id']}/stream"
    headers = _hdr(token, org["id"])

    # 预占会话锁（等价于已有进行中的生成）→ 第二个请求 409 CONVERSATION_BUSY（chat.md D11）
    lock = ChatService._lock_for(conv["id"])
    await lock.acquire()
    try:
        second = await client.post(
            url, json={"content": "又来"}, headers=headers
        )
        assert second.status_code == 409
        assert second.json()["code"] == "CONVERSATION_BUSY"
    finally:
        lock.release()

    # 流正常结束后锁释放，可再次发送
    async with client.stream(
        "POST", url, json={"content": "继续"}, headers=headers
    ) as resp:
        events = await _read_sse(resp)
    assert [e for e, _ in events].count("done") == 1
    assert ChatService._lock_for(conv["id"]).locked() is False

    third = await client.post(url, json={"content": "第三次"}, headers=headers)
    assert third.status_code == 200


async def test_stream_disconnect_releases_lock(client, db, monkeypatch):
    """断流收敛（chat.md 2.6 中断路径）：生成器关闭 → finally 释放会话锁"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    blocker = asyncio.Event()
    monkeypatch.setattr(
        llm_module.LLMClient, "chat_stream", _fake_chat(["第一段"], blocker=blocker)
    )

    user = (
        await db.execute(select(User).where(User.email == "alice@test.com"))
    ).scalar_one()
    org_obj = (await db.execute(select(Organization).where(Organization.id == org["id"]))).scalar_one()

    service = ChatService(db)
    await service.prepare_stream(
        org_obj, user, conv["id"], MessageCreateRequest(content="你好")
    )
    gen = service.sse_events()
    first_chunk = await gen.__anext__()
    assert "event: message" in first_chunk
    # 客户端断流 → 生成器关闭（Starlette 取消语义的等价行为）→ finally 释放锁
    await gen.aclose()
    assert ChatService._lock_for(conv["id"]).locked() is False


# ---------- 其他 ----------


async def test_viewer_cannot_chat(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org = await _create_org(client, alice)
    agent = await _create_agent(client, alice, org["id"])
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "viewer"},
        headers=_auth(alice),
    )

    # viewer 只读：列表可用，创建会话/发送消息 403（chat.md D8）
    lst = await client.get("/api/v1/conversations", headers=_hdr(bob, org["id"]))
    assert lst.status_code == 200
    resp = await _create_conversation(client, bob, org["id"], agent["id"])
    assert resp.status_code == 403


async def test_sync_send_message(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["完整回答"]))
    resp = await client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "同步提问"},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "assistant"
    assert resp.json()["content"] == "完整回答"
    assert resp.json()["token_usage"]["total_tokens"] == 7


async def test_message_content_validation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    resp = await client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "   "},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "MESSAGE_CONTENT_REQUIRED"

    resp = await client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "x" * 10001},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 422


async def test_delete_conversation_cascades(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["回答"]))
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "提问"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        async for _ in resp.aiter_lines():
            pass

    resp = await client.delete(
        f"/api/v1/conversations/{conv['id']}", headers=_hdr(token, org["id"])
    )
    assert resp.status_code == 204
    assert (
        await client.get(
            f"/api/v1/conversations/{conv['id']}", headers=_hdr(token, org["id"])
        )
    ).status_code == 404
    assert (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 404


async def test_version_snapshot_stays_after_publish(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"], system_prompt="你是v1")
    v1_id = agent["current_version_detail"]["id"]
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    # 发布 v2 后，存量会话仍使用创建时快照的 v1（chat.md D6）
    v2 = (
        await client.post(
            f"/api/v1/agents/{agent['id']}/versions",
            json={
                "system_prompt": "你是v2",
                "model_provider": "openai",
                "model_name": "gpt-4o-mini",
            },
            headers=_hdr(token, org["id"]),
        )
    ).json()
    await client.post(
        f"/api/v1/agents/{agent['id']}/versions/{v2['id']}/publish",
        headers=_hdr(token, org["id"]),
    )

    captured = []
    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_chat(["答案"], captured=captured),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "继续"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        async for _ in resp.aiter_lines():
            pass

    assert captured[0]["messages"][0] == {"role": "system", "content": "你是v1"}
    detail = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}", headers=_hdr(token, org["id"])
        )
    ).json()
    assert detail["agent_version_id"] == v1_id