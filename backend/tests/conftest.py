# tests/conftest.py
# 测试基础设施：自动创建测试库并迁移，提供数据库会话与 HTTP 客户端
import asyncio
import os
from pathlib import Path

import pytest
import pytest_asyncio
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import URL, delete, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parents[1]

# 测试库地址：默认与本机 MySQL 同源账号建 agenthub_test 库，可用 TEST_DATABASE_URL 覆盖
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "mysql+asyncmy://root:123456@localhost:3306/agenthub_test",
)


async def _ensure_database() -> None:
    """创建测试库（如不存在）"""
    url = make_url(TEST_DATABASE_URL)
    server_url = URL.create(
        drivername=url.drivername,
        username=url.username,
        password=url.password,
        host=url.host,
        port=url.port,
    )
    engine = create_async_engine(server_url.render_as_string(hide_password=False))
    async with engine.begin() as conn:
        await conn.execute(
            text(
                f"CREATE DATABASE IF NOT EXISTS `{url.database}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
    await engine.dispose()


def _run_migrations() -> None:
    """同步执行迁移（env.py 内部自带事件循环，必须与 asyncio.run 分离调用）"""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session", autouse=True)
def _prepare_database():
    asyncio.run(_ensure_database())
    _run_migrations()


@pytest.fixture(scope="session")
def engine(_prepare_database):
    """测试引擎：NullPool 保证每次借还都是全新连接，避免 asyncmy 连接跨事件循环复用"""
    eng = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield eng
    # dispose 是异步方法且 NullPool 无留存连接，用临时循环安全释放连接池资源
    asyncio.run(eng.dispose())


@pytest_asyncio.fixture
async def db(engine):
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture(autouse=True)
async def _cleanup(engine):
    """每个用例结束后清空业务数据（保留预置的 roles）"""
    yield
    from app.models import (
        Agent,
        AgentVersion,
        Conversation,
        Document,
        DocumentChunk,
        KnowledgeBase,
        Message,
        Organization,
        OrganizationMember,
        User,
    )

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        # 外键顺序：消息 → 会话 → 版本 → 智能体 → 切块 → 文档 → 知识库 → 成员 → 组织 → 用户
        await session.execute(delete(Message))
        await session.execute(delete(Conversation))
        await session.execute(delete(AgentVersion))
        await session.execute(delete(Agent))
        await session.execute(delete(DocumentChunk))
        await session.execute(delete(Document))
        await session.execute(delete(KnowledgeBase))
        await session.execute(delete(OrganizationMember))
        await session.execute(delete(Organization))
        await session.execute(delete(User))
        await session.commit()


@pytest_asyncio.fixture
async def client(db):
    """基于真实 app 的 HTTP 客户端，get_db 依赖指向测试库会话"""
    from app.api import deps
    from app.main import app

    async def override_get_db():
        yield db

    app.dependency_overrides[deps.get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c
    app.dependency_overrides.pop(deps.get_db, None)
