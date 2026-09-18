# repositories/user_repo.py
# users 表数据访问层（Service 层不直接写 SQL）
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import OrganizationMember, User


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: int) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def create(self, user: User) -> User:
        """新增用户并 flush 拿到自增 id"""
        self.db.add(user)
        await self.db.flush()
        return user

    async def get_memberships(self, user_id: int) -> list[OrganizationMember]:
        """查询用户所有组织成员关系（含组织与角色，避免 N+1）"""
        result = await self.db.execute(
            select(OrganizationMember)
            .where(OrganizationMember.user_id == user_id)
            .options(
                selectinload(OrganizationMember.organization),
                selectinload(OrganizationMember.role),
            )
        )
        return list(result.scalars().all())