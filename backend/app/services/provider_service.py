# services/provider_service.py
# 模型供应商业务逻辑（model-providers.md §5）：CRUD + 组织隔离 + 密钥加密 + 测试连接 + 引用删除保护
# 组织存在/成员身份/角色校验在 api/deps.require_header_org_role；归属校验（跨组织一律 404）为第二道闸
import time

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    AppError,
    ModelProviderFieldRequired,
    ModelProviderInUse,
    ModelProviderModelConflict,
    ModelProviderNameConflict,
    ModelProviderNotFound,
    ProviderUrlForbidden,
)
from app.models import AgentVersion, ModelProvider, Organization, ProviderModel, User
from app.schemas.model_provider import (
    ModelProviderCreateRequest,
    ModelProviderDetail,
    ModelProviderUpdateRequest,
    ProviderModelCreateRequest,
    ProviderModelItem,
    ProviderModelUpdateRequest,
    TestConnectionRequest,
    TestConnectionResponse,
)
from app.services.model_catalog import (
    REQUIRES_API_KEY,
    import_preset,
    provider_type_default_capabilities,
)
from app.utils.crypto import decrypt_api_key, encrypt_api_key, mask_api_key
from app.utils.ssrf import validate_provider_url


class ProviderService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---------- 供应商 CRUD ----------

    async def create_provider(
        self, org: Organization, user: User, data: ModelProviderCreateRequest
    ) -> ModelProviderDetail:
        """创建供应商：SSRF 校验 → 名称唯一 → 必密校验 → 加密落库 → 一次性导入预置目录（D8）"""
        validate_provider_url(data.base_url)
        if await self._name_exists(org.id, data.name):
            raise ModelProviderNameConflict()
        if data.provider_type in REQUIRES_API_KEY and not (data.api_key or "").strip():
            raise ModelProviderFieldRequired("API Key")
        provider = ModelProvider(
            organization_id=org.id,
            name=data.name,
            provider_type=data.provider_type,
            base_url=data.base_url,
            api_key_encrypted=(
                encrypt_api_key(data.api_key) if (data.api_key or "").strip() else None
            ),
            enabled=data.enabled,
            created_by=user.id,
        )
        self.db.add(provider)
        try:
            await self.db.flush()
            await import_preset(self.db, provider)
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            # 并发同名 → 唯一约束；目录导入不会产生 IntegrityError
            raise ModelProviderNameConflict() from exc
        await self.db.refresh(provider)
        return await self._detail(provider)

    async def list_providers(self, org: Organization) -> list[ModelProviderDetail]:
        providers = (
            (
                await self.db.execute(
                    select(ModelProvider)
                    .where(ModelProvider.organization_id == org.id)
                    .order_by(ModelProvider.id)
                )
            )
            .scalars()
            .all()
        )
        return [await self._detail(p) for p in providers]

    async def get_provider(
        self, org: Organization, provider_id: int
    ) -> ModelProviderDetail:
        return await self._detail(await self._get_in_org(org, provider_id))

    async def update_provider(
        self, org: Organization, provider_id: int, data: ModelProviderUpdateRequest
    ) -> ModelProviderDetail:
        """部分更新；api_key 三态语义（D5）：缺省保留 / 空串 null 清空（仅免密类型）/ 非空替换"""
        provider = await self._get_in_org(org, provider_id)
        values = data.model_dump(exclude_unset=True)
        if "name" in values:
            if not values["name"]:
                raise ModelProviderFieldRequired("供应商名称")
            if values["name"] != provider.name and await self._name_exists(
                org.id, values["name"]
            ):
                raise ModelProviderNameConflict()
            provider.name = values["name"]
        if values.get("base_url") is not None:
            validate_provider_url(values["base_url"])
            provider.base_url = values["base_url"]
        if values.get("enabled") is not None:
            provider.enabled = values["enabled"]
        if "api_key" in values:
            key = values["api_key"]
            if key is None or key == "":
                # 显式清空：必密类型不允许（D5），免密类型置 NULL
                if provider.provider_type in REQUIRES_API_KEY:
                    raise AppError(
                        422,
                        "MODEL_PROVIDER_FIELD_REQUIRED",
                        "该供应商类型必须配置 API Key，不能清空",
                    )
                provider.api_key_encrypted = None
            else:
                provider.api_key_encrypted = encrypt_api_key(key)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ModelProviderNameConflict() from exc
        await self.db.refresh(provider)
        return await self._detail(provider)

    async def delete_provider(self, org: Organization, provider_id: int) -> None:
        """删除供应商（D7 事务内双重防护）：引用计数预检 → 删除捕获 FK RESTRICT IntegrityError"""
        provider = await self._get_in_org(org, provider_id)
        ref_count = (
            (
                await self.db.execute(
                    select(AgentVersion.id).where(
                        AgentVersion.provider_id == provider.id
                    )
                )
            )
            .scalars()
            .first()
        )
        if ref_count is not None:
            raise ModelProviderInUse()
        try:
            await self.db.delete(provider)
            await self.db.commit()
        except IntegrityError as exc:
            # 并发窗口：预检后有版本创建引用了该供应商（D7）
            await self.db.rollback()
            raise ModelProviderInUse() from exc

    # ---------- 模型清单 ----------

    async def add_model(
        self,
        org: Organization,
        provider_id: int,
        data: ProviderModelCreateRequest,
    ) -> ProviderModelItem:
        provider = await self._get_in_org(org, provider_id)
        model = ProviderModel(
            provider_id=provider.id,
            model_key=data.model_key,
            display_name=data.display_name or data.model_key,
            capabilities=(
                data.capabilities.model_dump()
                if data.capabilities is not None
                else provider_type_default_capabilities(provider.provider_type)
            ),
            enabled=data.enabled,
        )
        self.db.add(model)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ModelProviderModelConflict() from exc
        await self.db.refresh(model)
        return self._model_item(model)

    async def update_model(
        self,
        org: Organization,
        provider_id: int,
        model_id: int,
        data: ProviderModelUpdateRequest,
    ) -> ProviderModelItem:
        model = await self._get_model_in_org(org, provider_id, model_id)
        values = data.model_dump(exclude_unset=True)
        if values.get("display_name") is not None:
            model.display_name = values["display_name"]
        if values.get("capabilities") is not None:
            model.capabilities = values["capabilities"]
        if values.get("enabled") is not None:
            model.enabled = values["enabled"]
        await self.db.commit()
        await self.db.refresh(model)
        return self._model_item(model)

    async def delete_model(
        self, org: Organization, provider_id: int, model_id: int
    ) -> None:
        """删除模型行（D7：弱引用不校验，chat 侧自动回落默认能力）"""
        model = await self._get_model_in_org(org, provider_id, model_id)
        await self.db.delete(model)
        await self.db.commit()

    # ---------- 测试连接（D13） ----------

    @staticmethod
    async def test_connection(
        data: TestConnectionRequest,
    ) -> TestConnectionResponse:
        """两模式：model_key 缺省 → GET /models（连通 + 鉴权）；提供 → POST /chat/completions。
        测试失败不抛 HTTP 错误，返回 ok=false + error_type（§6 枚举）；
        消息使用固定模板，不回传上游响应正文 / 内部地址（§6 安全约定）"""
        started = time.monotonic()
        try:
            validate_provider_url(data.base_url)
        except ProviderUrlForbidden as exc:
            return TestConnectionResponse(
                ok=False, latency_ms=0, error_type="forbidden", message=exc.message
            )
        # 必密类型但请求未带 key（编辑页留空 = 不修改已存密钥）：不阻断测试，
        # 由上游返回 401/403 后统一映射为 error_type=auth（D13：测试失败不抛 HTTP 错误，
        # 与表单提示「不带密钥测试，必密类型返回鉴权失败」一致）
        headers = {"Content-Type": "application/json"}
        if (data.api_key or "").strip():
            headers["Authorization"] = f"Bearer {data.api_key}"
        base = data.base_url.rstrip("/")
        timeout = httpx.Timeout(
            connect=10.0,
            read=settings.PROVIDER_TEST_TIMEOUT_SECONDS,
            write=10.0,
            pool=10.0,
        )
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if data.model_key:
                    resp = await client.post(
                        f"{base}/chat/completions",
                        json={
                            "model": data.model_key,
                            "messages": [{"role": "user", "content": "ping"}],
                            "max_tokens": 1,
                        },
                        headers=headers,
                    )
                else:
                    resp = await client.get(f"{base}/models", headers=headers)
        except (httpx.HTTPError, OSError):
            # OSError 兜底：绕过 httpx 封装的原始连接错误（如 DNS/套接字层失败）
            return TestConnectionResponse(
                ok=False,
                latency_ms=ProviderService._latency(started),
                error_type="network",
                message="无法连接到供应商地址",
            )
        return ProviderService._test_result(
            resp.status_code, ProviderService._latency(started), data.model_key
        )

    # ---------- 内部 ----------

    @staticmethod
    def _latency(started: float) -> int:
        return max(0, int((time.monotonic() - started) * 1000))

    @staticmethod
    def _test_result(
        status_code: int, latency_ms: int, model_key: str | None
    ) -> TestConnectionResponse:
        """状态码 → error_type 稳定映射（§6 表）；一律不带上游正文"""
        if status_code == 200:
            return TestConnectionResponse(ok=True, latency_ms=latency_ms)
        if status_code in (401, 403):
            return TestConnectionResponse(
                ok=False,
                latency_ms=latency_ms,
                error_type="auth",
                message="API Key 无效或无权限",
            )
        if status_code == 404 and model_key:
            return TestConnectionResponse(
                ok=False,
                latency_ms=latency_ms,
                error_type="model_not_found",
                message="模型标识不存在或不可用",
            )
        return TestConnectionResponse(
            ok=False,
            latency_ms=latency_ms,
            error_type="unknown",
            message="供应商返回异常状态"
            + ("（地址或路径不正确）" if status_code == 404 else ""),
        )

    async def _get_in_org(self, org: Organization, provider_id: int) -> ModelProvider:
        """归属校验：不存在或不属于当前组织一律 404（不泄露跨组织存在性，KB 同模式）"""
        provider = await self.db.get(ModelProvider, provider_id)
        if provider is None or provider.organization_id != org.id:
            raise ModelProviderNotFound()
        return provider

    async def _get_model_in_org(
        self, org: Organization, provider_id: int, model_id: int
    ) -> ProviderModel:
        await self._get_in_org(org, provider_id)
        model = await self.db.get(ProviderModel, model_id)
        if model is None or model.provider_id != provider_id:
            raise ModelProviderNotFound()
        return model

    async def _name_exists(self, org_id: int, name: str) -> bool:
        result = await self.db.execute(
            select(ModelProvider.id)
            .where(
                ModelProvider.organization_id == org_id,
                ModelProvider.name == name,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def _detail(self, provider: ModelProvider) -> ModelProviderDetail:
        """掩码展示（D5）：解密取回掩码；解密失败 key_status=invalid（D14 可重填）。
        API 永不回传明文，解密仅发生在服务端内存"""
        masked: str | None = None
        key_status: str = "empty"
        if provider.api_key_encrypted:
            try:
                masked = mask_api_key(decrypt_api_key(provider.api_key_encrypted))
                key_status = "set"
            except Exception:  # noqa: BLE001 - 展示路径降级，不因坏密文阻塞列表
                key_status = "invalid"
        models = (
            (
                await self.db.execute(
                    select(ProviderModel)
                    .where(ProviderModel.provider_id == provider.id)
                    .order_by(ProviderModel.id)
                )
            )
            .scalars()
            .all()
        )
        return ModelProviderDetail(
            id=provider.id,
            name=provider.name,
            provider_type=provider.provider_type,
            base_url=provider.base_url,
            api_key_masked=masked,
            key_status=key_status,
            enabled=provider.enabled,
            models=[self._model_item(m) for m in models],
            created_at=provider.created_at,
        )

    @staticmethod
    def _model_item(model: ProviderModel) -> ProviderModelItem:
        return ProviderModelItem(
            id=model.id,
            model_key=model.model_key,
            display_name=model.display_name,
            capabilities=model.capabilities,
            enabled=model.enabled,
        )
