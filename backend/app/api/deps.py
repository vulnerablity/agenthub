# api/deps.py
# 公共依赖注入：数据库会话、当前用户、角色校验（RBAC 基础设施）
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.exceptions import Forbidden, TokenInvalid, UserInactive, UserNotFound
from app.db.session import async_session_factory
from app.models import OrganizationMember, Role, User


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """提供数据库会话，请求结束自动关闭"""
    async with async_session_factory() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
    db: DbSession,
) -> User:
    """解析 Bearer Access Token 并返回当前用户（校验签名/类型/有效期/账号状态）"""
    if credentials is None:
        raise TokenInvalid()
    payload = security.decode_token(credentials.credentials, expected_type="access")
    user = await db.get(User, int(payload["sub"]))
    if user is None:
        raise UserNotFound()
    if user.status != "active":
        raise UserInactive()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*allowed_roles: str):
    """依赖工厂：要求当前用户在任一组织拥有指定角色（供后续 RBAC 接口复用）"""

    async def role_checker(user: CurrentUser, db: DbSession) -> User:
        result = await db.execute(
            select(func.count(OrganizationMember.id))
            .join(Role, Role.id == OrganizationMember.role_id)
            .where(
                OrganizationMember.user_id == user.id,
                Role.name.in_(allowed_roles),
            )
        )
        if (result.scalar_one() or 0) == 0:
            raise Forbidden()
        return user

    return role_checker
