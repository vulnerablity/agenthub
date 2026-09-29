# utils/crypto.py
# 供应商 api_key 对称加密（model-providers.md D5/D14）：Fernet 加解密与掩码
# 依赖 cryptography==50.0.1（requirements.txt 既有，MySQL 认证依赖），零新增
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.exceptions import EncryptionKeyMissing, ProviderKeyInvalid


def _fernet() -> Fernet:
    """构造 Fernet 实例；密钥格式合法性由 startup 校验兜底（D14）"""
    if not settings.ENCRYPTION_KEY:
        raise EncryptionKeyMissing()
    return Fernet(settings.ENCRYPTION_KEY.encode())


def encrypt_api_key(plain: str) -> str:
    """明文 → 密文；ENCRYPTION_KEY 未配置时 500 阻断（建/换 key 场景）"""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_api_key(cipher: str) -> str:
    """密文 → 明文；密文损坏或密钥不匹配 → 502（对话路径降级，D14 允许更新/删除供应商）"""
    try:
        return _fernet().decrypt(cipher.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise ProviderKeyInvalid() from exc


def mask_api_key(plain: str) -> str:
    """展示掩码（D5）：前 3 后 4，长度不足 8 全 *，永不回传明文"""
    if len(plain) < 8:
        return "*" * len(plain) if plain else ""
    return f"{plain[:3]}****{plain[-4:]}"
