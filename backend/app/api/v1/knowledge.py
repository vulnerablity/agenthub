# api/v1/knowledge.py
# 知识库接口（需求文档 3.6）：顶层路径 /knowledge-bases 与 /documents，组织隔离经 X-Organization-Id 请求头
# 角色：写类端点 owner/admin，读类端点含 viewer（knowledge.md 权限矩阵）；归属校验在 KnowledgeService 内完成
from typing import Annotated

from fastapi import APIRouter, Depends, Response, UploadFile

from app.api.deps import DbSession, require_header_org_role
from app.models import Organization, OrganizationMember
from app.schemas.knowledge import (
    DocumentListItem,
    DocumentStatusDetail,
    KnowledgeBaseCreateRequest,
    KnowledgeBaseDetail,
    KnowledgeBaseUpdateRequest,
    SearchRequest,
    SearchResponse,
)
from app.services.knowledge_service import KnowledgeService

router = APIRouter(tags=["knowledge"])

# 组织作用域别名（组织 ID 来自请求头，路径不含 org）：依赖内部完成校验并返回 (org, membership)
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member", "viewer")),
]
AdminCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin")),
]


# ---------- 知识库 CRUD（需求 3.6 + 补充） ----------


@router.post(
    "/knowledge-bases", response_model=KnowledgeBaseDetail, status_code=201
)
async def create_knowledge_base(
    data: KnowledgeBaseCreateRequest, ctx: AdminCtx, db: DbSession
) -> KnowledgeBaseDetail:
    org, _ = ctx
    return await KnowledgeService(db).create_kb(org, data)


@router.get("/knowledge-bases", response_model=list[KnowledgeBaseDetail])
async def list_knowledge_bases(ctx: OrgCtx, db: DbSession) -> list[KnowledgeBaseDetail]:
    org, _ = ctx
    return await KnowledgeService(db).list_kbs(org)


@router.get("/knowledge-bases/{kb_id}", response_model=KnowledgeBaseDetail)
async def get_knowledge_base(kb_id: int, ctx: OrgCtx, db: DbSession) -> KnowledgeBaseDetail:
    org, _ = ctx
    return await KnowledgeService(db).get_kb(org, kb_id)


@router.patch("/knowledge-bases/{kb_id}", response_model=KnowledgeBaseDetail)
async def update_knowledge_base(
    kb_id: int, data: KnowledgeBaseUpdateRequest, ctx: AdminCtx, db: DbSession
) -> KnowledgeBaseDetail:
    org, _ = ctx
    return await KnowledgeService(db).update_kb(org, kb_id, data)


@router.delete("/knowledge-bases/{kb_id}", status_code=204)
async def delete_knowledge_base(kb_id: int, ctx: AdminCtx, db: DbSession) -> Response:
    org, _ = ctx
    await KnowledgeService(db).delete_kb(org, kb_id)
    return Response(status_code=204)


# ---------- 文档（需求 3.6 + 补充） ----------


@router.post(
    "/knowledge-bases/{kb_id}/documents",
    response_model=DocumentListItem,
    status_code=201,
)
async def upload_document(
    kb_id: int, ctx: AdminCtx, db: DbSession, file: UploadFile
) -> DocumentListItem:
    org, _ = ctx
    content = await file.read()
    return await KnowledgeService(db).upload_document(
        org, kb_id, file.filename or "", content
    )


@router.get(
    "/knowledge-bases/{kb_id}/documents", response_model=list[DocumentListItem]
)
async def list_kb_documents(
    kb_id: int, ctx: OrgCtx, db: DbSession
) -> list[DocumentListItem]:
    org, _ = ctx
    return await KnowledgeService(db).list_kb_documents(org, kb_id)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: int, ctx: AdminCtx, db: DbSession) -> Response:
    org, _ = ctx
    await KnowledgeService(db).delete_document(org, document_id)
    return Response(status_code=204)


@router.get("/documents/{document_id}/status", response_model=DocumentStatusDetail)
async def get_document_status(
    document_id: int, ctx: OrgCtx, db: DbSession
) -> DocumentStatusDetail:
    org, _ = ctx
    return await KnowledgeService(db).get_document_status(org, document_id)


# ---------- RAG 检索（需求 3.6） ----------


@router.post("/knowledge-bases/{kb_id}/search", response_model=SearchResponse)
async def search_knowledge_base(
    kb_id: int, data: SearchRequest, ctx: OrgCtx, db: DbSession
) -> SearchResponse:
    org, _ = ctx
    return await KnowledgeService(db).search(org, kb_id, data)