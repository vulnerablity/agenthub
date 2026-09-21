# api/v1/conversations.py
# 对话接口（需求文档 3.5）：顶层路径 /conversations，组织隔离经 X-Organization-Id 请求头
# 角色：对话类端点排除 viewer（owner/admin/member），只读与删除端点含 viewer（chat.md 权限矩阵）
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, DbSession, require_header_org_role
from app.models import Organization, OrganizationMember
from app.schemas.chat import (
    ConversationCreateRequest,
    ConversationDetail,
    ConversationListItem,
    MessageCreateRequest,
    MessageDetail,
)
from app.services.chat_service import ChatService

router = APIRouter(prefix="/conversations", tags=["conversations"])

# 组织作用域别名（组织 ID 来自请求头，路径不含 org）：依赖内部完成校验并返回 (org, membership)
OrgCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member", "viewer")),
]
ChatCtx = Annotated[
    tuple[Organization, OrganizationMember],
    Depends(require_header_org_role("owner", "admin", "member")),
]

# SSE 响应头：禁用缓冲保证增量实时到达
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post("", response_model=ConversationDetail, status_code=201)
async def create_conversation(
    data: ConversationCreateRequest, ctx: ChatCtx, user: CurrentUser, db: DbSession
) -> ConversationDetail:
    org, _ = ctx
    return await ChatService(db).create_conversation(org, user, data)


@router.get("", response_model=list[ConversationListItem])
async def list_conversations(
    ctx: OrgCtx,
    user: CurrentUser,
    db: DbSession,
    agent_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ConversationListItem]:
    org, _ = ctx
    return await ChatService(db).list_conversations(org, user, agent_id, limit, offset)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: int, ctx: OrgCtx, user: CurrentUser, db: DbSession
) -> ConversationDetail:
    org, _ = ctx
    return await ChatService(db).get_conversation(org, user, conversation_id)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: int, ctx: OrgCtx, user: CurrentUser, db: DbSession
) -> Response:
    org, _ = ctx
    await ChatService(db).delete_conversation(org, user, conversation_id)
    return Response(status_code=204)


@router.get("/{conversation_id}/messages", response_model=list[MessageDetail])
async def list_messages(
    conversation_id: int,
    ctx: OrgCtx,
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
    before_id: Annotated[int | None, Query()] = None,
) -> list[MessageDetail]:
    org, _ = ctx
    return await ChatService(db).list_messages(
        org, user, conversation_id, limit, before_id
    )


@router.post(
    "/{conversation_id}/messages", response_model=MessageDetail, status_code=201
)
async def send_message(
    conversation_id: int,
    data: MessageCreateRequest,
    ctx: ChatCtx,
    user: CurrentUser,
    db: DbSession,
) -> MessageDetail:
    org, _ = ctx
    return await ChatService(db).send_message(org, user, conversation_id, data)


@router.post("/{conversation_id}/stream")
async def stream_chat(
    conversation_id: int,
    data: MessageCreateRequest,
    ctx: ChatCtx,
    user: CurrentUser,
    db: DbSession,
) -> StreamingResponse:
    org, _ = ctx
    service = ChatService(db)
    # 流前校验集中在此：业务错误（404/409/400）以统一 JSON 返回，不走 SSE（chat.md 2.4）
    await service.prepare_stream(org, user, conversation_id, data)
    return StreamingResponse(
        service.sse_events(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )