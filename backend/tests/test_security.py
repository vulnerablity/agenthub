# tests/test_security.py
# 安全层单元测试：密码哈希与 JWT（不依赖数据库）
import pytest

from app.core import security
from app.core.exceptions import TokenInvalid


class TestPasswordHash:
    def test_hash_and_verify(self):
        hashed = security.hash_password("secret123")
        assert hashed != "secret123"
        assert security.verify_password("secret123", hashed)

    def test_wrong_password_rejected(self):
        hashed = security.hash_password("secret123")
        assert not security.verify_password("wrong-pass", hashed)


class TestJwt:
    def test_access_token_roundtrip(self):
        token = security.create_access_token(user_id=1, username="alice")
        payload = security.decode_token(token, expected_type="access")
        assert payload["sub"] == "1"
        assert payload["username"] == "alice"

    def test_refresh_token_roundtrip(self):
        token, jti = security.create_refresh_token(user_id=1)
        assert jti
        payload = security.decode_token(token, expected_type="refresh")
        assert payload["jti"] == jti

    def test_token_type_mismatch_rejected(self):
        token, _ = security.create_refresh_token(user_id=1)
        with pytest.raises(TokenInvalid):
            security.decode_token(token, expected_type="access")

    def test_tampered_token_rejected(self):
        token = security.create_access_token(user_id=1, username="alice")
        with pytest.raises(TokenInvalid):
            security.decode_token(token[:-2] + "xx", expected_type="access")