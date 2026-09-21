# integrations/embedding.py
# Embedding 客户端：OpenAI 兼容 /embeddings 批量调用（knowledge.md D10）
# 职责边界：纯基础设施组件，只负责 HTTP 调用与结果映射；模型名由调用方显式传入
# （worker 传 KB.embedding_model 落库值、检索传全局启动值），本组件不读取全局模型配置，
# 杜绝运行期配置漂移（knowledge.md D2）；可被后续 Tool / Agent Runtime 复用
import httpx

from app.core.config import settings
from app.core.exceptions import EmbeddingUpstreamError

# 两级超时：connect 固定 10s，read 60s（批量嵌入耗时高于 LLM 流式首字节）
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)


class EmbeddingClient:
    """/embeddings 批量客户端（OpenAI 兼容协议）"""

    def __init__(self) -> None:
        # 模块级单例复用连接池（单事件循环部署，同 LLMClient 模式）
        self._client = httpx.AsyncClient(timeout=_TIMEOUT)

    async def embed(self, texts: list[str], model: str) -> list[list[float]]:
        """批量向量化：返回与输入等长的向量列表（按 data[].index 排序保证顺序）"""
        if not texts:
            return []
        url = settings.embedding_base_url.rstrip("/") + "/embeddings"
        headers = {"Content-Type": "application/json"}
        if settings.embedding_api_key:
            headers["Authorization"] = f"Bearer {settings.embedding_api_key}"
        try:
            resp = await self._client.post(
                url, json={"model": model, "input": texts}, headers=headers
            )
            if resp.status_code != httpx.codes.OK:
                raise EmbeddingUpstreamError()
            payload = resp.json()
            items = sorted(payload["data"], key=lambda item: item["index"])
            return [item["embedding"] for item in items]
        except EmbeddingUpstreamError:
            raise
        except (httpx.TimeoutException, httpx.HTTPError) as exc:
            raise EmbeddingUpstreamError() from exc
        except (KeyError, TypeError, ValueError) as exc:
            # 上游响应结构异常同样归一为上游错误
            raise EmbeddingUpstreamError() from exc

    async def aclose(self) -> None:
        await self._client.aclose()


_client: EmbeddingClient | None = None


def get_embedding_client() -> EmbeddingClient:
    """模块级单例（测试以 monkeypatch EmbeddingClient.embed 替换真实调用）"""
    global _client
    if _client is None:
        _client = EmbeddingClient()
    return _client
