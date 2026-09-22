# tests/test_executions.py
# 执行监控集成测试（需求 3.8，execution.md）：执行链路落库（llm/rag/tool）与聚合列表/详情
# 覆盖：D3 权限矩阵（owner/admin 全量 / member 仅本人 / viewer 403）、组织隔离、D5 写入失败降级、筛选分页

from app.core.exceptions import LLMUpstreamError
from app.integrations import llm as llm_module
from app.repositories.execution_repo import ExecutionRepository
from app.schemas.knowledge import SearchResponse, SearchResultItem
from app.services.knowledge_service import KnowledgeService

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


async def _create_conversation(client, token, org_id, agent_id):
    return await client.post(
        "/api/v1/conversations",
        json={"agent_id": agent_id},
        headers=_hdr(token, org_id),
    )


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


async def _create_kb(client, token, org_id, name="员工手册"):
    return (
        await client.post(
            "/api/v1/knowledge-bases", json={"name": name}, headers=_hdr(token, org_id)
        )
    ).json()


async def _stream(client, token, org_id, conversation_id, content="提问"):
    return await client.post(
        f"/api/v1/conversations/{conversation_id}/stream",
        json={"content": content},
        headers=_hdr(token, org_id),
    )


def _fake_chat(deltas, usage=None, error_after=None):
    """假 LLM 流：按序产出 delta，收尾 usage（可流中抛错）"""

    async def chat_stream(
        self, *, messages, model, temperature=None, max_tokens=None, tools=None
    ):
        for delta in deltas:
            yield {"delta": delta}
        if error_after is not None:
            raise error_after
        yield {
            "usage": usage
            or {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}
        }

    return chat_stream


def _fake_tool_loop(rounds):
    """带工具调用的假 LLM 流（同 test_chat）：每轮消费一个描述，最后一轮无 tool_calls 终答"""
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


def _tool_call(name="计算器", expression="1+1", call_id="call_1"):
    return {
        "id": call_id,
        "name": name,
        "arguments": {"expression": expression},
        "args_error": None,
    }


# ---------- 核心链路落库（RAG + Tool + 多轮 LLM） ----------


async def test_execution_tool_loop_recorded(client, monkeypatch):
    """工具循环一次执行：2 轮 LLM + 1 次工具 → 3 步落库、usage 2 条、token 汇总 30"""
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
                {"deltas": ["让我"], "tool_calls": [_tool_call()]},
                {"deltas": ["答案是 2"]},
            ]
        ),
    )
    resp = await _stream(client, token, org["id"], conv["id"], "1+1 等于几")
    assert resp.status_code == 200

    # 列表聚合：一次 execution，3 步，token 汇总
    lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org["id"]))
    ).json()
    assert lst["total"] == 1
    item = lst["items"][0]
    assert item["agent_id"] == agent["id"]
    assert item["agent_name"] == "客服助手"
    assert item["conversation_id"] == conv["id"]
    assert item["step_count"] == 3
    assert item["error_steps"] == 0
    assert item["status"] == "success"
    assert item["total_tokens"] == 30
    assert item["duration_ms"] >= 0

    # 详情：步骤链路时序（llm → tool → llm）与 usage
    detail = (
        await client.get(
            f"/api/v1/executions/{item['execution_id']}", headers=_hdr(token, org["id"])
        )
    ).json()
    steps = detail["steps"]
    assert [(s["step_type"], s["step_name"], s["status"]) for s in steps] == [
        ("llm", "llm_round_1", "success"),
        ("tool", "tool_计算器", "success"),
        ("llm", "llm_round_2", "success"),
    ]
    tool_step = steps[1]
    assert tool_step["input_json"] == {
        "round": 1,
        "name": "计算器",
        "arguments": {"expression": "1+1"},
    }
    assert tool_step["output_json"] == {"status": "ok", "output": "2", "error": None}
    assert steps[2]["output_json"]["has_tool_calls"] is False
    usages = detail["usages"]
    assert [u["round"] for u in usages] == [1, 2]
    assert all(u["model"] == "gpt-4o-mini" for u in usages)
    assert all(u["total_tokens"] == 15 for u in usages)
    assert detail["total_tokens"] == 30
    assert detail["user_id"] == item["user_id"]


async def test_execution_rag_step_recorded(client, monkeypatch):
    """RAG 会话：rag_retrieval 步骤（query/kb_ids/hit_count）+ llm 步骤"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    agent = await _create_agent(
        client,
        token,
        org["id"],
        name="知识助手",
        config_json={"rag": {"knowledge_base_ids": [kb["id"]], "rag_top_k": 3}},
    )
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    async def fake_search(self, org, kb_id, data):
        return SearchResponse(
            results=[
                SearchResultItem(
                    content="员工满一年享有五天年假",
                    document="假期政策.txt",
                    page=3,
                    score=0.95,
                )
            ]
        )

    monkeypatch.setattr(KnowledgeService, "search", fake_search)
    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["年假五天"]))
    resp = await _stream(client, token, org["id"], conv["id"], "年假几天")
    assert resp.status_code == 200

    lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org["id"]))
    ).json()
    detail = (
        await client.get(
            f"/api/v1/executions/{lst['items'][0]['execution_id']}",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [s["step_type"] for s in detail["steps"]] == ["rag", "llm"]
    rag_step = detail["steps"][0]
    assert rag_step["step_name"] == "rag_retrieval"
    assert rag_step["status"] == "success"
    assert rag_step["input_json"]["knowledge_base_ids"] == [kb["id"]]
    assert rag_step["input_json"]["top_k"] == 3
    assert rag_step["output_json"]["hit_count"] == 1
    assert detail["status"] == "success"
    # 无 RAG 绑定不产生 rag 步骤（普通对话仅 llm）
    plain_agent = await _create_agent(client, token, org["id"], name="普通助手")
    plain_conv = (
        await _create_conversation(client, token, org["id"], plain_agent["id"])
    ).json()
    resp = await _stream(client, token, org["id"], plain_conv["id"], "你好")
    assert resp.status_code == 200
    lst = (
        await client.get(
            f"/api/v1/executions?conversation_id={plain_conv['id']}",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    detail = (
        await client.get(
            f"/api/v1/executions/{lst['items'][0]['execution_id']}",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [s["step_type"] for s in detail["steps"]] == ["llm"]


async def test_execution_rag_degraded_marks_error(client, monkeypatch):
    """RAG 检索降级：rag 步骤 status=error → execution status=error，对话仍正常完成"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    agent = await _create_agent(
        client,
        token,
        org["id"],
        config_json={"rag": {"knowledge_base_ids": [kb["id"]], "rag_top_k": 3}},
    )
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    from app.core.exceptions import VectorStoreError

    async def broken_search(self, org, kb_id, data):
        raise VectorStoreError()

    monkeypatch.setattr(KnowledgeService, "search", broken_search)
    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["降级回答"]))
    resp = await _stream(client, token, org["id"], conv["id"], "提问")
    assert resp.status_code == 200

    lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org["id"]))
    ).json()
    item = lst["items"][0]
    assert item["status"] == "error"
    assert item["error_steps"] == 1
    detail = (
        await client.get(
            f"/api/v1/executions/{item['execution_id']}", headers=_hdr(token, org["id"])
        )
    ).json()
    rag_step = detail["steps"][0]
    assert rag_step["status"] == "error"
    assert rag_step["output_json"]["degraded"] is True
    assert rag_step["output_json"]["reason"] == "VECTOR_STORE_ERROR"


async def test_execution_llm_error_marked(client, monkeypatch):
    """LLM 上游错误：error 步骤留痕（error_code），execution status=error"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    monkeypatch.setattr(
        llm_module.LLMClient,
        "chat_stream",
        _fake_chat(["部分"], error_after=LLMUpstreamError()),
    )
    resp = await _stream(client, token, org["id"], conv["id"], "提问")
    assert resp.status_code == 200

    lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org["id"]))
    ).json()
    item = lst["items"][0]
    assert item["status"] == "error"
    detail = (
        await client.get(
            f"/api/v1/executions/{item['execution_id']}", headers=_hdr(token, org["id"])
        )
    ).json()
    llm_step = detail["steps"][0]
    assert llm_step["step_type"] == "llm"
    assert llm_step["status"] == "error"
    assert llm_step["output_json"]["error_code"] == "LLM_UPSTREAM_ERROR"
    assert detail["usages"] == []


# ---------- 权限矩阵与组织隔离（D3） ----------


async def test_execution_member_scope(client, monkeypatch):
    """member 仅见本人发起（D3）：owner 全量 2 条，member 1 条；member 越权详情 404"""
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org = await _create_org(client, alice)
    agent = await _create_agent(client, alice, org["id"])
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice),
    )
    conv_a = (await _create_conversation(client, alice, org["id"], agent["id"])).json()
    conv_b = (await _create_conversation(client, bob, org["id"], agent["id"])).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["回答"]))
    assert (
        await _stream(client, alice, org["id"], conv_a["id"], "alice 提问")
    ).status_code == 200
    assert (
        await _stream(client, bob, org["id"], conv_b["id"], "bob 提问")
    ).status_code == 200

    alice_list = (
        await client.get("/api/v1/executions", headers=_hdr(alice, org["id"]))
    ).json()
    assert alice_list["total"] == 2
    bob_list = (
        await client.get("/api/v1/executions", headers=_hdr(bob, org["id"]))
    ).json()
    assert bob_list["total"] == 1
    bob_item = bob_list["items"][0]
    assert bob_item["conversation_id"] == conv_b["id"]

    # member 访问他人执行 → 404（不泄露存在性）；owner 可访问
    alice_execution = next(
        i for i in alice_list["items"] if i["conversation_id"] == conv_a["id"]
    )
    resp = await client.get(
        f"/api/v1/executions/{alice_execution['execution_id']}",
        headers=_hdr(bob, org["id"]),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "EXECUTION_NOT_FOUND"
    resp = await client.get(
        f"/api/v1/executions/{bob_item['execution_id']}",
        headers=_hdr(alice, org["id"]),
    )
    assert resp.status_code == 200


async def test_execution_viewer_and_missing_header_forbidden(client):
    """viewer 访问 403；无组织头 403（不泄露组织存在性）"""
    await _register(client, "alice@test.com", "alice")
    await _register(client, "carol@test.com", "carol")
    alice = await _token(client, "alice@test.com")
    carol = await _token(client, "carol@test.com")
    org = await _create_org(client, alice)
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "carol@test.com", "role": "viewer"},
        headers=_auth(alice),
    )

    resp = await client.get("/api/v1/executions", headers=_hdr(carol, org["id"]))
    assert resp.status_code == 403
    assert resp.json()["code"] == "FORBIDDEN"

    resp = await client.get("/api/v1/executions", headers=_auth(alice))
    assert resp.status_code == 403


async def test_execution_cross_org_isolation(client, monkeypatch):
    """跨组织访问执行 → 404：exchange org 头后详情不可见"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org_a = await _create_org(client, token, name="A")
    org_b = await _create_org(client, token, name="B")
    agent_a = await _create_agent(client, token, org_a["id"])
    conv = (
        await _create_conversation(client, token, org_a["id"], agent_a["id"])
    ).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["回答"]))
    await _stream(client, token, org_a["id"], conv["id"], "提问")
    lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org_a["id"]))
    ).json()

    # 换 org B 头：列表不含、详情 404
    lst_b = (
        await client.get("/api/v1/executions", headers=_hdr(token, org_b["id"]))
    ).json()
    assert lst_b["total"] == 0
    resp = await client.get(
        f"/api/v1/executions/{lst['items'][0]['execution_id']}",
        headers=_hdr(token, org_b["id"]),
    )
    assert resp.status_code == 404


# ---------- 筛选与分页 ----------


async def test_execution_filter_and_pagination(client, monkeypatch):
    """按 agent/conversation/status 筛选；分页 total 正确"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    other = await _create_agent(client, token, org["id"], name="另一助手")
    conv1 = (await _create_conversation(client, token, org["id"], agent["id"])).json()
    conv2 = (await _create_conversation(client, token, org["id"], agent["id"])).json()
    conv3 = (await _create_conversation(client, token, org["id"], other["id"])).json()

    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["回答"]))
    for conv in (conv1, conv2, conv3):
        await _stream(client, token, org["id"], conv["id"], "提问")

    # 全部 3 条；按 agent 过滤 2 条；按 conversation 过滤 1 条
    all_lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org["id"]))
    ).json()
    assert all_lst["total"] == 3
    by_agent = (
        await client.get(
            f"/api/v1/executions?agent_id={agent['id']}", headers=_hdr(token, org["id"])
        )
    ).json()
    assert by_agent["total"] == 2
    assert all(i["agent_id"] == agent["id"] for i in by_agent["items"])
    by_conv = (
        await client.get(
            f"/api/v1/executions?conversation_id={conv1['id']}",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert by_conv["total"] == 1
    assert by_conv["items"][0]["conversation_id"] == conv1["id"]

    # 状态筛选与分页参数
    ok = (
        await client.get(
            "/api/v1/executions?status=success&limit=2&offset=0",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert ok["total"] == 3
    assert len(ok["items"]) == 2
    err = (
        await client.get(
            "/api/v1/executions?status=error", headers=_hdr(token, org["id"])
        )
    ).json()
    assert err["total"] == 0
    page2 = (
        await client.get(
            "/api/v1/executions?limit=2&offset=2", headers=_hdr(token, org["id"])
        )
    ).json()
    assert page2["total"] == 3
    assert len(page2["items"]) == 1


# ---------- 健壮性（D5：写库失败不中断对话） ----------


async def test_execution_log_failure_does_not_break_chat(client, monkeypatch):
    """日志写入抛错 → 对话流正常 done、消息落库、执行列表为空（D5：Service 层兜底不外抛）"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    agent = await _create_agent(client, token, org["id"])
    conv = (await _create_conversation(client, token, org["id"], agent["id"])).json()

    async def broken_add_step(self, step):
        raise RuntimeError("db down")

    monkeypatch.setattr(ExecutionRepository, "add_step", broken_add_step)
    monkeypatch.setattr(llm_module.LLMClient, "chat_stream", _fake_chat(["正常回答"]))
    resp = await _stream(client, token, org["id"], conv["id"], "提问")
    assert resp.status_code == 200

    messages = (
        await client.get(
            f"/api/v1/conversations/{conv['id']}/messages",
            headers=_hdr(token, org["id"]),
        )
    ).json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    lst = (
        await client.get("/api/v1/executions", headers=_hdr(token, org["id"]))
    ).json()
    assert lst["total"] == 0
