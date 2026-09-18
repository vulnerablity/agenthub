# services/auth_service.py
# 注册 / 登录 / 刷新 / 当前用户 业务逻辑
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import (
    EmailAlreadyRegistered,
    InvalidCredentials,
    TokenInvalid,
    UserInactive,
    UserNotFound,
)
from app.db.redis import redis_store
from app.models import User
from app.repositories.user_repo import UserRepository
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    OrganizationBrief,
    RegisterRequest,
    TokenResponse,
)


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.user_repo = UserRepository(db)

    async def register(self, data: RegisterRequest) -> User:
        """注册：校验邮箱唯一性，密码 argon2 哈希后入库；不创建组织"""
        if await self.user_repo.get_by_email(data.email):
            raise EmailAlreadyRegistered()
        user = User(
            email=data.email,
            username=data.username,
            password_hash=security.hash_password(data.password),
        )
        try:
            await self.user_repo.create(user)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise EmailAlreadyRegistered() from exc
        return user

    async def login(self, data: LoginRequest) -> TokenResponse:
        """登录：校验账号密码，签发双 Token"""
        user = await self.user_repo.get_by_email(data.email)
        if user is None or not security.verify_password(data.password, user.password_hash):
            raise InvalidCredentials()
        if user.status != "active":
            raise UserInactive()
        return await self._issue_tokens(user)

    async def refresh(self, refresh_token: str) -> TokenResponse:
        """换发：校验 refresh token 并消费 jti（旧 token 作废），签发新双 Token"""
        payload = security.decode_token(refresh_token, expected_type="refresh")
        jti = payload.get("jti")
        if not jti or not await redis_store.consume_refresh_jti(jti):
            raise TokenInvalid()
        user = await self.user_repo.get_by_id(int(payload["sub"]))
        if user is None:
            raise UserNotFound()
        if user.status != "active":
            raise UserInactive()
        return await self._issue_tokens(user)

    async def get_me(self, user_id: int) -> MeResponse:
        """当前用户：基本信息 + 所属组织 + 各组织内角色"""
        user = await self.user_repo.get_by_id(user_id)
        if user is None:
            raise UserNotFound()
        memberships = await self.user_repo.get_memberships(user_id)
        organizations = [
            OrganizationBrief(
                id=membership.organization_id,
                name=membership.organization.name,
                role=membership.role.name,
            )
            for membership in memberships
        ]
        return MeResponse(
            id=user.id,
            email=user.email,
            username=user.username,
            avatar_url=user.avatar_url,
            status=user.status,
            created_at=user.created_at,
            organizations=organizations,
        )

    async def _issue_tokens(self, user: User) -> TokenResponse:
        access_token = security.create_access_token(user.id, user.username)
        refresh_token, jti = security.create_refresh_token(user.id)
        await redis_store.store_refresh_jti(jti, user.id, settings.refresh_token_expire_seconds)
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=settings.access_token_expire_seconds,
        )