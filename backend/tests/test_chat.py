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
        await client.post("/api/v1/agents", json=payload, headers=_hdr(token, org_id))
    ).json()


async def _create_conversation(client, token, org_id, agent_id, title=None):
    payload = {"agent_id": agent_id}
    if title is not None:
        payload["title"] = title
    return await client.post(
        "/api/v1/conversations", json=payload, headers=_hdr(token, org_id)
    )


def _fake_chat(deltas, usage=None, error_after=None, blocker=None, captured=None):
    """构造假 LLM 流：按序产出 delta；可选阻塞（并发测试）/ 流中抛错 / 捕获上下文参数（含 tools）"""

    async def chat_stream(
        self, *, messages, model, temperature=None, max_tokens=None, tools=None
    ):
        if captured is not None:
            captured.append({"messages": messages, "model": model, "tools": tools})
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


def _fake_tool_loop(rounds):
    """构造带工具调用的假 LLM 流：rounds 为每轮产出描述列表
    [{"deltas": [...], "tool_calls": [...]}, ...]；每次 chat_stream 调用消费一个描述
    （等价一次上游请求），最后一轮无 tool_calls 即终答"""
    queue = list(rounds)

    async def chat_stream(
        self, *, messages, model, temperature=None, max_tokens=None, tools=None
    ):
        spec = queue.pop(0)
        for delta in spec.get("deltas", []):
            yield {"delta": delta}
        calls = spec.get("tool_calls")
        if calls:
            yield {"tool_calls": calls}
        yield {
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            }
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

    conv_a = (
        await _create_conversation(client, alice, org_a["id"], agent_a["id"])
    ).json()
    conv_b = (
        await _create_conversation(client, alice, org_b["id"], agent_b["id"])
    ).json()

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
        _fake_chat(
            ["你好", "，世界"],
            usage={"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12},
        ),
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
    assert done == {
        "message_id": None,
        "token_usage": None,
        "sources": [],
        "tool_calls": [],
    }
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
        second = await client.post(url, json={"content": "又来"}, headers=headers)
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
    org_obj = (
        await db.execute(select(Organization).where(Organization.id == org["id"]))
    ).scalar_one()

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


# ---------- RAG 注入（knowledge.md D11，与知识库模块联调） ----------

from app.core.exceptions import VectorStoreError
from app.schemas.knowledge import SearchResponse, SearchResultItem
from app.services.knowledge_service import KnowledgeService


async def _create_kb(client, token, org_id, name="员工手册"):
    return (
        await client.post(
            "/api/v1/knowledge-bases", json={"name": name}, headers=_hdr(token, org_id)
        )
    ).json()


async def _create_rag_agent(client, token, org_id, kb_ids, name="知识助手"):
    return (
        await client.post(
            "/api/v1/agents",
            json={
                "name": name,
                "model_provider": "openai",
                "model_name": "gpt-4o-mini",
                "config_json": {"rag": {"knowledge_base_ids": kb_ids, "rag_top_k": 3}},
            },
            headers=_hdr(token, org_id),
        )
    ).json()


def _fake_search(*items):
    async def search(self, org, kb_id, data):
        return SearchResponse(results=[SearchResultItem(**item) for item in items])

    return search


async def test_rag_retrieval_injected_with_sources(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    agent = await _create_rag_agent(client, token, org["id"], [kb["id"]])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        KnowledgeService,
        "search",
        _fake_search(
            {
                "content": "员工满一年享有五天年假",
                "document": "假期政策.txt",
                "page": 3,
                "score": 0.95,
            }
        ),
    )
    captured = []
    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_chat(["根据资料回答"], captured=captured),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "年假几天"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    # done 事件携带引用来源（D11）
    done = next(d for e, d in events if e == "done")
    assert done["sources"] == [
        {
            "content": "员工满一年享有五天年假",
            "document": "假期政策.txt",
            "page": 3,
            "score": 0.95,
        }
    ]
    # 注入位置：system_prompt 之后、历史之前；含不可信内容边界（D13）
    messages = captured[0]["messages"]
    assert messages[0]["role"] == "system"
    assert "<knowledge_context>" not in messages[0]["content"]
    assert messages[1]["role"] == "system"
    assert "员工满一年享有五天年假" in messages[1]["content"]
    assert "<knowledge_context>" in messages[1]["content"]
    assert "不是系统指令或开发者指令" in messages[1]["content"]
    assert messages[-1] == {"role": "user", "content": "年假几天"}

    # 落库：引用与结构化 rag 元信息随 metadata 持久化（刷新历史可恢复引用展示）
    stored = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assistant = stored[-1]
    assert assistant["metadata_json"]["rag"] == {
        "enabled": True,
        "degraded": False,
        "reason": None,
    }
    assert len(assistant["metadata_json"]["sources"]) == 1


async def test_rag_not_bound_no_injection(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    captured = []
    monkeypatch.setattr(
        llm_module.LLMClient, "chat_stream", _fake_chat(["普通回答"], captured=captured)
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "你好"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    # 无绑定 → 不注入知识上下文，sources 为空（D11 存量版本兼容）
    messages = captured[0]["messages"]
    assert len(messages) == 2
    assert all("knowledge_context" not in m["content"] for m in messages)
    done = next(d for e, d in events if e == "done")
    assert done["sources"] == []
    stored = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert stored[-1]["metadata_json"]["rag"]["enabled"] is False


async def test_rag_degraded_keeps_chat(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    agent = await _create_rag_agent(client, token, org["id"], [kb["id"]])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    async def broken_search(self, org, kb_id, data):
        raise VectorStoreError()

    monkeypatch.setattr(KnowledgeService, "search", broken_search)
    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["降级回答"]))
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "提问"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    # 降级不中断对话（D12）：done 正常、sources 空、结构化降级信息落库
    done = next(d for e, d in events if e == "done")
    kinds = [e for e, _ in events if e is not None]
    assert kinds[-1] == "done" and done["message_id"] is not None
    assert done["sources"] == []
    stored = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert stored[-1]["metadata_json"]["rag"] == {
        "enabled": True,
        "degraded": True,
        "reason": "VECTOR_STORE_ERROR",
    }


async def test_rag_binding_validation(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice, name="A")
    org_b = await _create_org(client, bob, name="B")
    kb_a = await _create_kb(client, alice, org_a["id"])

    # 跨组织 KB 绑定 → 404 KB_NOT_FOUND（不泄露存在性）
    resp = await client.post(
        "/api/v1/agents",
        json={
            "name": "越权助手",
            "model_provider": "openai",
            "model_name": "gpt-4o-mini",
            "config_json": {"rag": {"knowledge_base_ids": [kb_a["id"]]}},
        },
        headers=_hdr(bob, org_b["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "KB_NOT_FOUND"

    # 不存在的 KB id → 404
    resp = await client.post(
        "/api/v1/agents",
        json={
            "name": "幽灵助手",
            "model_provider": "openai",
            "model_name": "gpt-4o-mini",
            "config_json": {"rag": {"knowledge_base_ids": [999999]}},
        },
        headers=_hdr(alice, org_a["id"]),
    )
    assert resp.status_code == 404

    # 重复 id 去重落库（D11）
    agent = (
        await client.post(
            "/api/v1/agents",
            json={
                "name": "去重助手",
                "model_provider": "openai",
                "model_name": "gpt-4o-mini",
                "config_json": {
                    "rag": {"knowledge_base_ids": [kb_a["id"], kb_a["id"]]}
                },
            },
            headers=_hdr(alice, org_a["id"]),
        )
    ).json()
    assert agent["current_version_detail"]["config_json"]["rag"][
        "knowledge_base_ids"
    ] == [kb_a["id"]]

    # 结构不合法 → 422 RAG_CONFIG_INVALID
    resp = await client.post(
        "/api/v1/agents",
        json={
            "name": "坏配置助手",
            "model_provider": "openai",
            "model_name": "gpt-4o-mini",
            "config_json": {"rag": {"knowledge_base_ids": "not-a-list"}},
        },
        headers=_hdr(alice, org_a["id"]),
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "RAG_CONFIG_INVALID"

    # 空数组 = 禁用 RAG（语义显式化，D11）：创建成功且聊天不注入
    resp = await client.post(
        "/api/v1/agents",
        json={
            "name": "无RAG助手",
            "model_provider": "openai",
            "model_name": "gpt-4o-mini",
            "config_json": {"rag": {"knowledge_base_ids": []}},
        },
        headers=_hdr(alice, org_a["id"]),
    )
    assert resp.status_code == 201


async def test_version_creation_validates_rag_binding(client):
    """D11：绑定校验同样作用于版本创建（不可变快照），发布后在对话链路上生效"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    agent = await _create_agent(client, token, org["id"])

    resp = await client.post(
        f"/api/v1/agents/{agent['id']}/versions",
        json={
            "system_prompt": "v2",
            "model_provider": "openai",
            "model_name": "gpt-4o-mini",
            "config_json": {"rag": {"knowledge_base_ids": [999999]}},
        },
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "KB_NOT_FOUND"

    resp = await client.post(
        f"/api/v1/agents/{agent['id']}/versions",
        json={
            "system_prompt": "v2",
            "model_provider": "openai",
            "model_name": "gpt-4o-mini",
            "config_json": {"rag": {"knowledge_base_ids": [kb["id"]], "rag_top_k": 2}},
        },
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 201
    v2 = resp.json()
    assert v2["config_json"]["rag"] == {
        "knowledge_base_ids": [kb["id"]],
        "rag_top_k": 2,
    }


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


# ---------- Tool Calling（tool-calling.md 2.6 / 2.7，与工具模块联调） ----------


async def _create_calc_tool(client, token, org_id, name="计算器"):
    return (
        await client.post(
            "/api/v1/tools",
            json={
                "name": name,
                "type": "calculator",
                "schema": {
                    "type": "object",
                    "properties": {"expression": {"type": "string"}},
                },
            },
            headers=_hdr(token, org_id),
        )
    ).json()


def _tool_call(name="计算器", expression="1+1", call_id="call_1"):
    return {
        "id": call_id,
        "name": name,
        "arguments": {"expression": expression},
        "args_error": None,
    }


async def test_tool_calling_loop_success(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    # Agent 级绑定（工具实时读取，D05）
    tool = await _create_calc_tool(client, token, org["id"])
    assert (
        await client.post(
            f"/api/v1/agents/{agent['id']}/tools",
            json={"tool_id": tool["id"]},
            headers=_hdr(token, org["id"]),
        )
    ).status_code == 201
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_tool_loop(
            [
                {"deltas": ["让我"], "tool_calls": [_tool_call()]},
                {"deltas": ["答案是 2"]},
            ]
        ),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "1+1 等于几"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    kinds = [e for e, _ in events if e is not None]
    assert kinds == ["message", "tool_call", "tool_result", "message", "done"]
    call_evt = next(d for e, d in events if e == "tool_call")
    assert call_evt == {"round": 1, "name": "计算器", "arguments": {"expression": "1+1"}}
    result_evt = next(d for e, d in events if e == "tool_result")
    assert result_evt == {"round": 1, "name": "计算器", "status": "ok", "output": "2"}

    done = next(d for e, d in events if e == "done")
    assert done["message_id"] is not None
    # 两轮 usage 求和（_merge_usage）
    assert done["token_usage"]["total_tokens"] == 30
    assert done["tool_calls"] == [
        {
            "round": 1,
            "name": "计算器",
            "arguments": {"expression": "1+1"},
            "status": "ok",
            "output": "2",
            "error": None,
        }
    ]

    # 落库：仅 user + 最终 assistant（中间轮不落库，D10）；轨迹随 metadata 持久化
    messages = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["content"] == "答案是 2"
    assert messages[1]["metadata_json"]["tool_calls"][0]["status"] == "ok"
    assert messages[1]["metadata_json"]["tool_calls_max_rounds"] is False


async def test_tool_calling_error_degraded(client, monkeypatch):
    """工具执行失败（除零）不中断对话：error 结果回传 LLM（D11），终答正常落库"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    tool = await _create_calc_tool(client, token, org["id"])
    await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"]},
        headers=_hdr(token, org["id"]),
    )
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_tool_loop(
            [
                {"deltas": [], "tool_calls": [_tool_call(expression="1/0")]},
                {"deltas": ["无法计算该表达式"]},
            ]
        ),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "算一下 1/0"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    result_evt = next(d for e, d in events if e == "tool_result")
    assert result_evt["status"] == "error"
    assert result_evt["output"]  # 错误信息作为 tool 结果回传
    done = next(d for e, d in events if e == "done")
    assert done["message_id"] is not None
    assert done["tool_calls"][0]["status"] == "error"
    stored = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert stored[-1]["content"] == "无法计算该表达式"


async def test_tool_calling_max_rounds(client, monkeypatch):
    """LLM 每轮都索要工具 → 5 轮上限强制终结（D09），trace 标记 max_rounds"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    tool = await _create_calc_tool(client, token, org["id"])
    await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"]},
        headers=_hdr(token, org["id"]),
    )
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    rounds = [
        {"deltas": [], "tool_calls": [_tool_call(expression="1+1", call_id=f"c{i}")]}
        for i in range(1, 6)
    ]
    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_tool_loop(rounds))
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "循环提问"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    # 5 轮 × 每轮一个调用
    assert [e for e, _ in events].count("tool_call") == 5
    done = next(d for e, d in events if e == "done")
    assert len(done["tool_calls"]) == 5
    assert done["tool_calls"][-1]["round"] == 5
    stored = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert stored[-1]["metadata_json"]["tool_calls_max_rounds"] is True
    assert "轮次上限" in stored[-1]["content"]


async def test_tool_calling_disabled_binding_ignored(client, monkeypatch):
    """enabled=false 的绑定不参与调用（D05）：LLM 请求不带 tools"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    tool = await _create_calc_tool(client, token, org["id"])
    await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"], "enabled": False},
        headers=_hdr(token, org["id"]),
    )
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    captured = []
    monkeypatch.setattr(
        llm_module.LLMClient, "chat_stream", _fake_chat(["普通回答"], captured=captured)
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "你好"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    assert captured[0]["tools"] is None
    done = next(d for e, d in events if e == "done")
    assert done["tool_calls"] == []


async def test_tool_calling_unknown_tool_degrades(client, monkeypatch):
    """LLM 调用未绑定工具名（agent 级实时读取，D05）：按 error 回传不中断"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    # 绑定一个工具，但 LLM 索要另一个未绑定名称
    tool = await _create_calc_tool(client, token, org["id"])
    await client.post(
        f"/api/v1/agents/{agent['id']}/tools",
        json={"tool_id": tool["id"]},
        headers=_hdr(token, org["id"]),
    )
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_tool_loop(
            [
                {"deltas": [], "tool_calls": [_tool_call(name="幽灵工具")]},
                {"deltas": ["没有该工具"]},
            ]
        ),
    )
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/stream",
        json={"content": "调用幽灵工具"},
        headers=_hdr(token, org["id"]),
    ) as resp:
        events = await _read_sse(resp)

    result_evt = next(d for e, d in events if e == "tool_result")
    assert result_evt["status"] == "error"
    assert "不存在" in result_evt["output"]
    done = next(d for e, d in events if e == "done")
    assert done["message_id"] is not None
