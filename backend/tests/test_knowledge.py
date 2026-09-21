# tests/test_knowledge.py
# 知识库接口集成测试：覆盖 KB CRUD / 组织隔离 / 上传校验 / 异步处理状态机 / 删除竞态 /
# Embedding 模型一致性 / 双写失败清理 / 检索结构 / 权限矩阵 / 重启恢复（knowledge.md 6）
import asyncio

import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import settings
from app.integrations import embedding as embedding_module
from app.integrations.vector_store import VectorStore
from app.models import Document, DocumentChunk
from app.services import document_worker as dw_module
from app.services.document_worker import get_worker

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


async def _create_kb(client, token, org_id, name="员工手册", **overrides):
    return (
        await client.post(
            "/api/v1/knowledge-bases",
            json={"name": name, **overrides},
            headers=_hdr(token, org_id),
        )
    ).json()


async def _upload(client, token, org_id, kb_id, filename, content):
    return await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        files={"file": (filename, content, "application/octet-stream")},
        headers=_hdr(token, org_id),
    )


async def _wait_status(engine, doc_id, expect="completed", timeout=10) -> dict:
    """以独立会话轮询文档状态（worker 在独立会话提交，app 长会话的 REPEATABLE READ
    快照看不到；经 API 断言视图前需先 db.rollback() 刷新其快照）"""
    factory = async_sessionmaker(engine, expire_on_commit=False)
    for _ in range(timeout * 10):
        async with factory() as session:
            doc = await session.get(Document, doc_id)
            if doc is not None and doc.status == expect:
                return {
                    "status": doc.status,
                    "chunk_count": doc.chunk_count,
                    "error_message": doc.error_message,
                }
        await asyncio.sleep(0.1)
    raise AssertionError(f"文档 {doc_id} 未在 {timeout}s 内达到状态 {expect}")


async def _add_member(client, token, org_id, email, role="member"):
    return await client.post(
        f"/api/v1/organizations/{org_id}/members",
        json={"email": email, "role": role},
        headers=_auth(token),
    )


# ---------- 测试环境：假 Embedding + 假向量库 + 每用例独立的 worker ----------


@pytest_asyncio.fixture(autouse=True)
async def knowledge_env(monkeypatch, engine, request):
    """每个用例：替换真实 Embedding/向量库调用（内存假实现），并启动绑定测试库的独立 worker"""
    env = {
        "embed_calls": [],  # (texts, model) 记录，用于模型一致性断言
        "vector_upserted": [],  # (vector_id, payload)
        "deleted_docs": [],
        "deleted_kbs": [],
        "search_hits": [],
        "blocker": None,
        "embed_error": None,
        "store_error": None,
    }

    async def fake_embed(self, texts, model):
        env["embed_calls"].append((list(texts), model))
        if env["blocker"] is not None:
            await env["blocker"].wait()
        if env["embed_error"] is not None:
            raise env["embed_error"]
        return [[0.1] * 8 for _ in texts]

    async def fake_upsert(self, points):
        if env["store_error"] is not None:
            raise env["store_error"]
        for vector_id, _vector, payload in points:
            env["vector_upserted"].append((vector_id, payload))

    async def fake_search(self, vector, kb_id, limit):
        if env["store_error"] is not None:
            raise env["store_error"]
        hits = [
            (0.91, dict(payload))
            for vector_id, payload in env["vector_upserted"]
            if payload.get("kb_id") == kb_id
        ][:limit]
        env["search_hits"].append(kb_id)
        return hits

    async def fake_delete_document(self, document_id):
        env["deleted_docs"].append(document_id)
        env["vector_upserted"] = [
            (vid, payload)
            for vid, payload in env["vector_upserted"]
            if payload.get("document_id") != document_id
        ]

    async def fake_delete_kb(self, kb_id):
        env["deleted_kbs"].append(kb_id)
        env["vector_upserted"] = [
            (vid, payload)
            for vid, payload in env["vector_upserted"]
            if payload.get("kb_id") != kb_id
        ]

    monkeypatch.setattr(embedding_module.EmbeddingClient, "embed", fake_embed)
    monkeypatch.setattr(VectorStore, "upsert", fake_upsert)
    monkeypatch.setattr(VectorStore, "search", fake_search)
    monkeypatch.setattr(VectorStore, "delete_document", fake_delete_document)
    monkeypatch.setattr(VectorStore, "delete_kb", fake_delete_kb)

    # worker 的数据库会话指向测试库（默认的 async_session_factory 指向本机开发库）
    monkeypatch.setattr(
        dw_module,
        "async_session_factory",
        async_sessionmaker(engine, expire_on_commit=False),
    )
    # 每个用例重置单例：avoid 跨事件循环复用队列
    dw_module.DocumentWorker._instance = None
    worker = get_worker()
    await worker.start()
    yield env
    await worker.stop()


# ---------- 知识库 CRUD 与组织隔离 ----------


async def test_create_kb_and_list(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)

    kb = await _create_kb(
        client,
        token,
        org["id"],
        description="公司制度",
        chunk_size=400,
        chunk_overlap=40,
    )
    assert kb["name"] == "员工手册"
    assert kb["description"] == "公司制度"
    # embedding_model 落库启动期全局值（knowledge.md D2）
    assert kb["embedding_model"] == settings.EMBEDDING_MODEL
    assert kb["chunk_size"] == 400
    assert kb["chunk_overlap"] == 40
    assert kb["document_count"] == 0

    lst = await client.get("/api/v1/knowledge-bases", headers=_hdr(token, org["id"]))
    assert lst.status_code == 200
    assert [k["name"] for k in lst.json()] == ["员工手册"]

    # 名称组织内唯一 → 409
    resp = await client.post(
        "/api/v1/knowledge-bases",
        json={"name": "员工手册"},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "KB_NAME_CONFLICT"

    # chunk 参数交叉校验：overlap >= size → 422
    resp = await client.post(
        "/api/v1/knowledge-bases",
        json={"name": "坏参数", "chunk_size": 100, "chunk_overlap": 100},
        headers=_hdr(token, org["id"]),
    )
    assert resp.status_code == 422


async def test_kb_isolation_and_404(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice, name="A")
    org_b = await _create_org(client, bob, name="B")
    kb = await _create_kb(client, alice, org_a["id"])

    # 无组织头 → 403
    assert (
        await client.get("/api/v1/knowledge-bases", headers=_auth(alice))
    ).status_code == 403
    # 非成员 → 403
    assert (
        await client.get("/api/v1/knowledge-bases", headers=_hdr(bob, org_a["id"]))
    ).status_code == 403
    # 跨组织 → 404（不泄露存在性）
    resp = await client.get(
        f"/api/v1/knowledge-bases/{kb['id']}", headers=_hdr(bob, org_b["id"])
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "KB_NOT_FOUND"
    # 不存在 id → 404
    assert (
        await client.get(
            "/api/v1/knowledge-bases/999999", headers=_hdr(alice, org_a["id"])
        )
    ).status_code == 404


async def test_kb_update_and_delete(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    second = await _create_kb(client, token, org["id"], name="第二库")
    hdr = _hdr(token, org["id"])

    resp = await client.patch(
        f"/api/v1/knowledge-bases/{kb['id']}",
        json={"name": "新名称", "description": "新描述"},
        headers=hdr,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "新名称"
    assert resp.json()["description"] == "新描述"
    # 改名撞名 → 409
    resp = await client.patch(
        f"/api/v1/knowledge-bases/{kb['id']}",
        json={"name": "第二库"},
        headers=hdr,
    )
    assert resp.status_code == 409

    assert (
        await client.delete(f"/api/v1/knowledge-bases/{second['id']}", headers=hdr)
    ).status_code == 204
    assert (await client.get("/api/v1/knowledge-bases", headers=hdr)).json()[0][
        "id"
    ] == kb["id"]


# ---------- 上传与异步处理 ----------


async def test_upload_validation(client, monkeypatch):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    # hdr = _hdr(token, org["id"])

    # 类型不支持
    resp = await _upload(client, token, org["id"], kb["id"], "a.docx", b"xx")
    assert resp.status_code == 400
    assert resp.json()["code"] == "FILE_TYPE_NOT_SUPPORTED"
    # 空文件
    resp = await _upload(client, token, org["id"], kb["id"], "a.txt", b"")
    assert resp.status_code == 400
    assert resp.json()["code"] == "FILE_EMPTY"
    # 超大小（临时调低上限）
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_MB", 1)
    resp = await _upload(
        client, token, org["id"], kb["id"], "a.txt", b"x" * (1024 * 1024 + 1)
    )
    assert resp.status_code == 413
    assert resp.json()["code"] == "FILE_TOO_LARGE"
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_MB", 20)

    # 无文件名 → 框架层 422（UploadFile 文件名为空直接拒绝）
    resp = await _upload(client, token, org["id"], kb["id"], "", b"xx")
    assert resp.status_code == 422


async def test_document_lifecycle_and_search(client, knowledge_env, db, engine):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    hdr = _hdr(token, org["id"])

    # 上传即返回 pending（异步处理，D4）
    resp = await _upload(
        client,
        token,
        org["id"],
        kb["id"],
        "假期政策.txt",
        "员工满一年享受五天年假。".encode(),
    )
    assert resp.status_code == 201
    doc = resp.json()
    assert doc["status"] == "pending"
    assert doc["filename"] == "假期政策.txt"

    # 状态列表含新文档；空库检索先验证
    empty = await client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search",
        json={"query": "年假", "top_k": 5},
        headers=hdr,
    )
    assert empty.status_code == 200
    assert empty.json()["results"] == []

    # worker 处理完成：chunk_count > 0
    status = await _wait_status(engine, doc["id"])
    assert status["chunk_count"] >= 1
    # 刷新 app 会话快照后，经 API 应看到 completed 状态与统计
    await db.rollback()
    docs = (
        await client.get(f"/api/v1/knowledge-bases/{kb['id']}/documents", headers=hdr)
    ).json()
    assert len(docs) == 1 and docs[0]["status"] == "completed"
    api_status = (
        await client.get(f"/api/v1/documents/{doc['id']}/status", headers=hdr)
    ).json()
    assert api_status["status"] == "completed"
    assert api_status["chunk_count"] == status["chunk_count"]

    # 检索结构对齐需求 3.6（content/document/page/score；txt 无页码 page=null）
    search = await client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search",
        json={"query": "员工年假是多少", "top_k": 5},
        headers=hdr,
    )
    assert search.status_code == 200
    results = search.json()["results"]
    assert len(results) >= 1
    hit = results[0]
    assert hit["document"] == "假期政策.txt"
    assert "年假" in hit["content"]
    assert hit["page"] is None
    assert 0 < hit["score"] <= 1

    # 删除文档：DB 行与向量点同步清理（D9）
    doc_id = doc["id"]
    assert (
        await client.delete(f"/api/v1/documents/{doc_id}", headers=hdr)
    ).status_code == 204
    assert doc_id in knowledge_env["deleted_docs"]
    assert (
        await client.get(f"/api/v1/documents/{doc_id}/status", headers=hdr)
    ).status_code == 404
    count = await db.execute(
        select(func.count(DocumentChunk.id)).where(DocumentChunk.document_id == doc_id)
    )
    assert count.scalar_one() == 0
    # 删除后检索为空
    search = await client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search",
        json={"query": "年假", "top_k": 5},
        headers=hdr,
    )
    assert search.json()["results"] == []


async def test_embeddng_model_uses_kb_snapshot(
    client, knowledge_env, monkeypatch, engine
):
    """Embedding 模型一致性（二轮评审 P0）：worker 用 KB 落库值，而非运行期全局配置（D2）"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    original_model = kb["embedding_model"]
    assert original_model == settings.EMBEDDING_MODEL

    # 创建 KB 后模拟运行期配置漂移：全局配置被“切换”为另一模型
    monkeypatch.setattr(settings, "EMBEDDING_MODEL", "switched-model")
    resp = await _upload(
        client, token, org["id"], kb["id"], "笔记.txt", "内容内容".encode()
    )
    assert resp.status_code == 201
    await _wait_status(engine, resp.json()["id"])

    models = {model for _texts, model in knowledge_env["embed_calls"]}
    assert original_model in models
    assert "switched-model" not in models


async def test_document_failed_marks_error(client, knowledge_env, db, engine):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    hdr = _hdr(token, org["id"])

    # 伪装成 pdf 的非法内容 → 解析失败 → failed + error_message（D6）
    resp = await _upload(
        client, token, org["id"], kb["id"], "坏文件.pdf", b"not a real pdf"
    )
    doc_id = resp.json()["id"]
    status = await _wait_status(engine, doc_id, expect="failed")
    assert status["error_message"]
    assert doc_id in knowledge_env["deleted_docs"]  # 失败路径清理向量点（双写一致性）

    # 文档仍在列表中且失败状态经 API 可见
    await db.rollback()
    docs = (
        await client.get(f"/api/v1/knowledge-bases/{kb['id']}/documents", headers=hdr)
    ).json()
    assert docs[0]["status"] == "failed"
    assert docs[0]["error_message"]


async def test_embedding_failure_marks_failed(client, knowledge_env, engine):
    from app.core.exceptions import EmbeddingUpstreamError

    knowledge_env["embed_error"] = EmbeddingUpstreamError()
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    resp = await _upload(client, token, org["id"], kb["id"], "a.txt", b"hello")
    status = await _wait_status(engine, resp.json()["id"], expect="failed")
    assert status["error_message"] == "Embedding 上游调用失败"


# ---------- 删除竞态（二轮评审 P0） ----------


async def test_processing_blocks_delete(client, knowledge_env, db, engine):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    hdr = _hdr(token, org["id"])

    blocker = asyncio.Event()
    knowledge_env["blocker"] = blocker
    doc = (
        await _upload(
            client, token, org["id"], kb["id"], "慢文档.txt", "慢处理文本".encode()
        )
    ).json()
    await _wait_status(engine, doc["id"], expect="processing")
    # 清空 app 会话事务与 identity map：worker 在独立会话置 processing，避免读到上传时的 pending 缓存
    await db.rollback()
    db.expire_all()

    # 处理中文档禁删 409；含处理中文档的 KB 禁删 409（knowledge.md D9）
    resp = await client.delete(f"/api/v1/documents/{doc['id']}", headers=hdr)
    assert resp.status_code == 409
    assert resp.json()["code"] == "DOCUMENT_PROCESSING"
    resp = await client.delete(f"/api/v1/knowledge-bases/{kb['id']}", headers=hdr)
    assert resp.status_code == 409
    assert resp.json()["code"] == "KB_PROCESSING"

    blocker.set()
    await _wait_status(engine, doc["id"], expect="completed")
    await db.rollback()
    db.expire_all()
    assert (
        await client.delete(f"/api/v1/knowledge-bases/{kb['id']}", headers=hdr)
    ).status_code == 204


async def test_worker_second_confirm_cleanup(client, knowledge_env, db, engine):
    """双写一致性（二轮评审 P1）：upsert 后文档已不存在 → 清理向量点且不落 chunks"""
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])
    # hdr = _hdr(token, org["id"])

    blocker = asyncio.Event()
    knowledge_env["blocker"] = blocker
    doc = (
        await _upload(
            client, token, org["id"], kb["id"], "竞态.txt", "竞争文档".encode()
        )
    ).json()
    await _wait_status(engine, doc["id"], expect="processing")

    # 模拟外部竞态：绕过接口直接删除文档行（正常情况下被 409 阻断，此处验证 worker 防御）
    result = await db.execute(select(Document).where(Document.id == doc["id"]))
    row = result.scalar_one()
    await db.delete(row)
    await db.commit()

    blocker.set()
    # 等待 worker 完成 upsert 后的二次确认与向量清理（避免固定 sleep 的时序抖动）
    for _ in range(50):
        if doc["id"] in knowledge_env["deleted_docs"]:
            break
        await asyncio.sleep(0.1)
    assert (
        doc["id"] in knowledge_env["deleted_docs"]
    )  # upsert 后二次确认发现已删 → 清理点
    count = await db.execute(
        select(func.count(DocumentChunk.id)).where(
            DocumentChunk.document_id == doc["id"]
        )
    )
    assert count.scalar_one() == 0


# ---------- 权限矩阵 ----------


async def test_viewer_member_permissions(client, knowledge_env, engine):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    await _register(client, "carol@test.com", "carol")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    carol = await _token(client, "carol@test.com")
    org = await _create_org(client, alice)
    await _add_member(client, alice, org["id"], "bob@test.com", role="member")
    await _add_member(client, alice, org["id"], "carol@test.com", role="viewer")
    kb = await _create_kb(client, alice, org["id"])
    doc = (
        await _upload(
            client, alice, org["id"], kb["id"], "权限.txt", "成员只读".encode()
        )
    ).json()
    await _wait_status(engine, doc["id"])

    # member：只读可用（列表/详情/状态/检索），写操作 403
    bob_hdr = _hdr(bob, org["id"])
    assert (
        await client.get("/api/v1/knowledge-bases", headers=bob_hdr)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/documents/{doc['id']}/status", headers=bob_hdr)
    ).status_code == 200
    search = await client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search",
        json={"query": "成员"},
        headers=bob_hdr,
    )
    assert search.status_code == 200 and search.json()["results"]
    assert (
        await client.post(
            "/api/v1/knowledge-bases", json={"name": "越权"}, headers=bob_hdr
        )
    ).status_code == 403
    assert (
        await _upload(client, bob, org["id"], kb["id"], "越权.txt", b"x")
    ).status_code == 403
    assert (
        await client.delete(f"/api/v1/knowledge-bases/{kb['id']}", headers=bob_hdr)
    ).status_code == 403

    # viewer 同样只读
    carol_hdr = _hdr(carol, org["id"])
    assert (
        await client.get("/api/v1/knowledge-bases", headers=carol_hdr)
    ).status_code == 200
    assert (
        await client.post(
            "/api/v1/knowledge-bases", json={"name": "越权"}, headers=carol_hdr
        )
    ).status_code == 403


# ---------- 重启恢复 ----------


async def test_recover_requeues_interrupted(client, knowledge_env, engine):
    """重启恢复：崩溃时 processing 文档在 worker 重启后重置为 pending 并重新入队完成处理"""
    from sqlalchemy import update

    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = await _create_org(client, token)
    kb = await _create_kb(client, token, org["id"])

    worker = get_worker()
    await worker.stop()
    doc = (
        await _upload(
            client, token, org["id"], kb["id"], "中断.txt", "中断恢复内容".encode()
        )
    ).json()
    # 模拟“处理中崩溃”：直接把状态拨到 processing 后进程重启
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        await session.execute(
            update(Document).where(Document.id == doc["id"]).values(status="processing")
        )
        await session.commit()

    # 进程“重启”：全新 worker 实例 + 空队列 → start 内 _recover 重置并重新入队
    dw_module.DocumentWorker._instance = None
    new_worker = get_worker()
    await new_worker.start()
    status = await _wait_status(engine, doc["id"])
    assert status["chunk_count"] >= 1
    await new_worker.stop()


# ---------- 检索隔离与不复用的补充 ----------


async def test_cross_org_document_hidden(client, knowledge_env, engine):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice = await _token(client, "alice@test.com")
    bob = await _token(client, "bob@test.com")
    org_a = await _create_org(client, alice, name="A")
    org_b = await _create_org(client, bob, name="B")
    kb = await _create_kb(client, alice, org_a["id"])
    doc = (
        await _upload(
            client, alice, org_a["id"], kb["id"], "隔离.txt", "隔离内容".encode()
        )
    ).json()
    await _wait_status(engine, doc["id"])

    # bob 在自己的组织上下文访问 alice 的文档/KB → 404（不泄露存在性）
    bob_hdr = _hdr(bob, org_b["id"])
    assert (
        await client.get(f"/api/v1/documents/{doc['id']}/status", headers=bob_hdr)
    ).status_code == 404
    assert (
        await client.delete(f"/api/v1/documents/{doc['id']}", headers=bob_hdr)
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/knowledge-bases/{kb['id']}", headers=bob_hdr)
    ).status_code == 404
    search = await client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search",
        json={"query": "隔离"},
        headers=bob_hdr,
    )
    assert search.status_code == 404
