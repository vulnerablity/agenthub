# api/v1/model_providers.py
# 模型供应商接口（model-providers.md §6）：顶层路径 /model-providers，组织隔离经 X-Organization-Id 请求头
# 角色：写类端点 owner/admin，读类端点全成员（Agent 表单两级下拉需要，model-providers.md D10）
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.api.deps import CurrentUser, DbSession, require_header_org_role
from app.models import Organization, OrganizationMember
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
from app.services.model_catalog import PRESET_CATALOGS, REQUIRES_API_KEY
from app.services.provider_service import ProviderService

router = APIRouter(tags=["model-providers"])

# 组织作用域别名（组织 ID 来自请求头，路径不含 org）：与 knowledge.py 同构
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member", "viewer")),
]
AdminCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin")),
]


# ---------- 供应商 CRUD ----------


@router.post("/model-providers", response_model=ModelProviderDetail, status_code=201)
async def create_model_provider(
    data: ModelProviderCreateRequest, ctx: AdminCtx, user: CurrentUser, db: DbSession
) -> ModelProviderDetail:
    org, _ = ctx
    return await ProviderService(db).create_provider(org, user, data)


@router.get("/model-providers", response_model=list[ModelProviderDetail])
async def list_model_providers(ctx: OrgCtx, db: DbSession) -> list[ModelProviderDetail]:
    org, _ = ctx
    return await ProviderService(db).list_providers(org)


@router.get("/model-providers/catalog")
async def get_provider_catalog(ctx: OrgCtx) -> dict:
    """预置目录预览（D8，表单用）：按 provider_type 返回模型清单与必密标记"""
    return {
        "catalogs": PRESET_CATALOGS,
        "requires_api_key": sorted(REQUIRES_API_KEY),
    }


@router.get("/model-providers/{provider_id}", response_model=ModelProviderDetail)
async def get_model_provider(
    provider_id: int, ctx: OrgCtx, db: DbSession
) -> ModelProviderDetail:
    org, _ = ctx
    return await ProviderService(db).get_provider(org, provider_id)


@router.patch("/model-providers/{provider_id}", response_model=ModelProviderDetail)
async def update_model_provider(
    provider_id: int,
    data: ModelProviderUpdateRequest,
    ctx: AdminCtx,
    db: DbSession,
) -> ModelProviderDetail:
    org, _ = ctx
    return await ProviderService(db).update_provider(org, provider_id, data)


@router.delete("/model-providers/{provider_id}", status_code=204)
async def delete_model_provider(
    provider_id: int, ctx: AdminCtx, db: DbSession
) -> Response:
    org, _ = ctx
    await ProviderService(db).delete_provider(org, provider_id)
    return Response(status_code=204)


# ---------- 测试连接（D13） ----------


@router.post("/model-providers/test-connection", response_model=TestConnectionResponse)
async def test_provider_connection(
    data: TestConnectionRequest, ctx: AdminCtx
) -> TestConnectionResponse:
    return await ProviderService.test_connection(data)


# ---------- 模型清单 ----------


@router.post(
    "/model-providers/{provider_id}/models",
    response_model=ProviderModelItem,
    status_code=201,
)
async def add_provider_model(
    provider_id: int,
    data: ProviderModelCreateRequest,
    ctx: AdminCtx,
    db: DbSession,
) -> ProviderModelItem:
    org, _ = ctx
    return await ProviderService(db).add_model(org, provider_id, data)


@router.patch(
    "/model-providers/{provider_id}/models/{model_id}",
    response_model=ProviderModelItem,
)
async def update_provider_model(
    provider_id: int,
    model_id: int,
    data: ProviderModelUpdateRequest,
    ctx: AdminCtx,
    db: DbSession,
) -> ProviderModelItem:
    org, _ = ctx
    return await ProviderService(db).update_model(org, provider_id, model_id, data)


@router.delete("/model-providers/{provider_id}/models/{model_id}", status_code=204)
async def delete_provider_model(
    provider_id: int, model_id: int, ctx: AdminCtx, db: DbSession
) -> Response:
    org, _ = ctx
    await ProviderService(db).delete_model(org, provider_id, model_id)
    return Response(status_code=204)
