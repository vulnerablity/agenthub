# db/redis.py
# Redis 客户端，用于 refresh token 的 jti 吊销（换发后旧 token 作废）
import redis.asyncio as aioredis
from redis.exceptions import RedisError

from app.core.config import settings

REFRESH_JTI_KEY = "refresh:jti:{jti}"


class RedisStore:
    """Redis 连接封装；本机未启动 Redis 时所有操作静默降级（不影响登录/注册）"""

    def __init__(self) -> None:
        self._client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

    async def store_refresh_jti(self, jti: str, user_id: int, ttl_seconds: int) -> None:
        """登记 refresh token 的 jti，ttl 与 refresh 有效期一致"""
        try:
            await self._client.set(
                REFRESH_JTI_KEY.format(jti=jti), str(user_id), ex=ttl_seconds
            )
        except RedisError:
            pass  # Redis 不可用时跳过登记：仅失去吊销能力，换发仍然可用

    async def consume_refresh_jti(self, jti: str) -> bool:
        """校验并消费 jti：成功删除返回 True（允许换发），已用过/不存在返回 False"""
        try:
            return bool(await self._client.delete(REFRESH_JTI_KEY.format(jti=jti)))
        except RedisError:
            return True  # Redis 不可用时放行，保证开发环境可运行


redis_store = RedisStore()