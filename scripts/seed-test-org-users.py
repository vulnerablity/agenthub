# scripts/seed-test-org-users.py
# 向本地 MySQL（agenthub 库）"测试组织"(id=1) 添加测试用户：
#   1 个管理员(admin1@qq.com) + 9 个普通成员(member1~member9@qq.com) + 1 个查看者(viewer1@qq.com)
# 密码均为 123456，使用与后端一致的 argon2（pwdlib PasswordHash.recommended()）哈希后入库。
#
# 运行方式（使用项目 backend 虚拟环境，与后端同库同驱动）：
#   C:\Users\86157\OneDrive\桌面\agenthub\backend\.venv\Scripts\python.exe scripts\seed-test-org-users.py
#
# 说明：脚本可重复执行——已存在的邮箱会跳过；已存在的组织成员关系会跳过。
import asyncio
import sys

from pwdlib import PasswordHash
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DB_URL = "mysql+asyncmy://root:123456@localhost:3306/agenthub"
ORG_ID = 1  # 测试组织
ROLE_IDS = {"admin": 2, "member": 3, "viewer": 4}  # 对应 roles 表
PASSWORD = "123456"

# (邮箱, 用户名, 角色)
USERS = [("admin1@qq.com", "admin1", "admin")]
USERS += [(f"member{i}@qq.com", f"member{i}", "member") for i in range(1, 10)]
USERS += [("viewer1@qq.com", "viewer1", "viewer")]


async def main() -> None:
    engine = create_async_engine(DB_URL, echo=False)
    ph = PasswordHash.recommended()
    async with engine.begin() as conn:
        org = (
            await conn.execute(
                text("SELECT id FROM organizations WHERE id = :oid"), {"oid": ORG_ID}
            )
        ).scalar()
        if org is None:
            raise SystemExit(f"错误：组织 id={ORG_ID} 不存在")

        created, skipped, failed = 0, 0, 0
        for email, username, role in USERS:
            try:
                existing = (
                    await conn.execute(
                        text("SELECT id FROM users WHERE email = :e"), {"e": email}
                    )
                ).scalar()
                if existing is not None:
                    print(f"SKIP 邮箱已存在 {email} (user_id={existing})")
                    skipped += 1
                    continue

                pwd_hash = ph.hash(PASSWORD)
                if not ph.verify(PASSWORD, pwd_hash):
                    raise RuntimeError("哈希自检失败")
                res = await conn.execute(
                    text(
                        "INSERT INTO users (email, username, password_hash) "
                        "VALUES (:e, :u, :h)"
                    ),
                    {"e": email, "u": username, "h": pwd_hash},
                )
                uid = res.lastrowid

                dup = (
                    await conn.execute(
                        text(
                            "SELECT id FROM organization_members "
                            "WHERE organization_id = :o AND user_id = :u"
                        ),
                        {"o": ORG_ID, "u": uid},
                    )
                ).scalar()
                if dup is None:
                    await conn.execute(
                        text(
                            "INSERT INTO organization_members "
                            "(organization_id, user_id, role_id) VALUES (:o, :u, :r)"
                        ),
                        {"o": ORG_ID, "u": uid, "r": ROLE_IDS[role]},
                    )
                print(f"OK {email} -> {role} (user_id={uid})")
                created += 1
            except Exception as exc:  # noqa: BLE001
                print(f"FAIL {email}: {exc}")
                failed += 1

        total = len(USERS)
        print(
            f"\n完成：共 {total} 个用户，新建 {created}，跳过 {skipped}，失败 {failed}"
        )
        if created != total:
            sys.exit(1)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
