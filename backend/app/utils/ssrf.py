# utils/ssrf.py
# 供应商 base_url 出站校验（model-providers.md D6）：默认仅 https + 公网 IP；
# ALLOW_PRIVATE_PROVIDER_URL=true（部署级全局开关）放行 http/内网（自建 Ollama 场景）。
# 残余风险（DNS rebinding TOCTOU）D6 一期接受，部署侧以容器出站白名单缓解
import ipaddress
import socket
from urllib.parse import urlparse

from app.core.config import settings
from app.core.exceptions import ProviderUrlForbidden


def validate_provider_url(url: str) -> None:
    """scheme 白名单 → 域名解析逐 IP 判内网/保留段；不合规抛 400 ProviderUrlForbidden"""
    parsed = urlparse(url)
    allow_private = settings.ALLOW_PRIVATE_PROVIDER_URL
    if parsed.scheme not in ("https", "http"):
        raise ProviderUrlForbidden(f"不支持的协议 {parsed.scheme or '(空)'}")
    if parsed.scheme == "http" and not allow_private:
        raise ProviderUrlForbidden("仅允许 https 地址（自建内网部署可开启 ALLOW_PRIVATE_PROVIDER_URL）")
    host = parsed.hostname
    if not host:
        raise ProviderUrlForbidden("地址缺少主机名")
    if allow_private:
        return
    try:
        infos = socket.getaddrinfo(
            host, parsed.port or (443 if parsed.scheme == "https" else 80)
        )
    except OSError as exc:
        raise ProviderUrlForbidden("域名解析失败") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ProviderUrlForbidden(f"禁止访问内网/保留地址 {ip}")
