# core/security.py
# 密码哈希（argon2）与 JWT 签发/解析
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from app.core.config import settings
from app.core.exceptions import TokenExpired, TokenInvalid

# pwdlib 推荐的 argon2 实现
_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """密码哈希，禁止明文入库"""
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    """校验明文密码与哈希是否匹配"""
    return _password_hash.verify(password, hashed)


def _create_token(
    sub: int, token_type: str, expires_delta: timedelta, extra: dict | None = None
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict = {
        "sub": str(sub),
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(
        payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )


def create_access_token(user_id: int, username: str) -> str:
    """签发无状态 Access Token（短期）"""
    return _create_token(
        user_id,
        "access",
        timedelta(seconds=settings.access_token_expire_seconds),
        {"username": username},
    )


def create_refresh_token(user_id: int) -> tuple[str, str]:
    """签发 Refresh Token，返回 (token, jti)；jti 用于 Redis 吊销"""
    jti = uuid.uuid4().hex
    token = _create_token(
        user_id,
        "refresh",
        timedelta(seconds=settings.refresh_token_expire_seconds),
        {"jti": jti},
    )
    return token, jti


def decode_token(token: str, expected_type: str) -> dict:
    """解析并校验 JWT：签名/有效期/类型均校验，失败抛对应业务异常"""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpired() from exc
    except jwt.InvalidTokenError as exc:
        raise TokenInvalid() from exc
    if payload.get("type") != expected_type:
        raise TokenInvalid()
    return payload
