# integrations/llm.py
# LLM 客户端：OpenAI 兼容协议流式调用（chat.md 2.5 / D9）
# 职责边界：纯基础设施组件，只负责 HTTP 调用 / 上游 SSE 解析 / 产出 delta 与 usage；
# 不依赖 FastAPI Request、不感知客户端断开。任务被取消时由 async with stream 上下文自动关闭上游连接，
# 取消语义自上层（ChatService 生成器）向下收敛，本组件可被后续 RAG / Tool / Agent Runtime 复用
import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import settings
from app.core.exceptions import LLMTimeout, LLMUpstreamError

# 两级超时：connect 固定 10s，read 覆盖首字节与流式读取（LLM_TIMEOUT_SECONDS）
_TIMEOUT = httpx.Timeout(
    connect=10.0, read=settings.LLM_TIMEOUT_SECONDS, write=30.0, pool=10.0
)


class LLMClient:
    """/chat/completions 流式客户端（stream=true，OpenAI 兼容协议）"""

    def __init__(self) -> None:
        # 模块级单例复用连接池（单事件循环部署，chat.md D11）
        self._client = httpx.AsyncClient(timeout=_TIMEOUT)

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[dict]:
        """逐条产出 {"delta": str}，收尾 {"usage": {...} | None}（上游不支持 usage 时为空）"""
        payload: dict = {
            "model": model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {"Content-Type": "application/json"}
        if settings.LLM_API_KEY:
            headers["Authorization"] = f"Bearer {settings.LLM_API_KEY}"

        url = settings.LLM_API_BASE.rstrip("/") + "/chat/completions"
        try:
            async with self._client.stream(
                "POST", url, json=payload, headers=headers
            ) as resp:
                if resp.status_code != httpx.codes.OK:
                    raise LLMUpstreamError()
                usage: dict | None = None
                async for line in resp.aiter_lines():
                    # OpenAI 兼容 SSE：data: 行承载 JSON 块，[DONE] 结束
                    if not line.startswith("data:"):
                        continue
                    raw = line[len("data:") :].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    delta_content = (
                        choices[0].get("delta", {}).get("content") if choices else None
                    )
                    if delta_content:
                        yield {"delta": delta_content}
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                yield {"usage": usage}
        except httpx.TimeoutException as exc:
            raise LLMTimeout() from exc
        except httpx.HTTPError as exc:
            raise LLMUpstreamError() from exc

    async def aclose(self) -> None:
        await self._client.aclose()


_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """模块级单例（测试以 monkeypatch LLMClient.chat_stream 替换真实调用）"""
    global _client
    if _client is None:
        _client = LLMClient()
    return _client