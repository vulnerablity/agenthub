# scripts/ensure-db.py
# 按 app.core.config 的 database_url 创建主库（如不存在），供 dev.ps1 在迁移前调用
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import asyncio

from sqlalchemy import URL, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings


async def main() -> None:
    url = make_url(settings.database_url)
    server_url = URL.create(
        drivername=url.drivername,
        username=url.username,
        password=url.password,
        host=url.host,
        port=url.port,
    )
    engine = create_async_engine(server_url.render_as_string(hide_password=False))
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{url.database}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
        print(f"OK: database `{url.database}` ready at {url.host}:{url.port}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
