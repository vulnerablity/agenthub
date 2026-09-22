# services/execution_service.py
# 执行监控编排（需求 3.8，execution.md）：记录 Agent 执行链路（LLM/RAG/Tool/Token/耗时）与查询
# D5：日志写入失败仅告警不抛出（会话内 rollback 恢复 transaction，不中断对话）
# D3：owner/admin 可见组织全部执行；member 仅本人发起（user_id 过滤），viewer 由 API 层 403
import json
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExecutionNotFound
from app.models import (
    Agent,
    ExecutionStep,
    LLMUsageLog,
    Organization,
    OrganizationMember,
    User,
)
from app.repositories.execution_repo import ExecutionRepository
from app.schemas.execution import (
    ExecutionDetail,
    ExecutionStepItem,
    ExecutionSummary,
    LLMUsageItem,
)

logger = logging.getLogger(__name__)

# input/output JSON 截断上限（execution.md D6）：超长记 {"truncated": true, "preview": ...}
MAX_JSON_CHARS = 8192


def new_execution_id() -> str:
    """一次生成（send/stream 请求）的 UUID 分组键（execution.md D1）"""
    return str(uuid.uuid4())


def compact_json(obj: dict | None) -> dict | None:
    """JSON 字段截断：可序列化则返回原对象；超长截为预览结构（避免超大上下文/工具结果撑爆日志行）"""
    if obj is None:
        return None
    try:
        text = json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        return {"unserializable": True}
    if len(text) <= MAX_JSON_CHARS:
        return obj
    return {"truncated": True, "size": len(text), "preview": text[:MAX_JSON_CHARS]}


class ExecutionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = ExecutionRepository(db)

    # ---------- 写入（供 ChatService 埋点，D5 失败不外抛） ----------

    @staticmethod
    def _quiet_commit(exc: Exception) -> None:
        logger.warning("execution log write skipped: %s", exc)

    async def record_step(
        self,
        *,
        execution_id: str,
        org_id: int,
        user_id: int,
        agent_id: int,
        conversation_id: int,
        step_type: str,
        step_name: str,
        status: str,
        input_data: dict | None = None,
        output_data: dict | None = None,
        duration_ms: int = 0,
    ) -> None:
        try:
            await self.repo.add_step(
                ExecutionStep(
                    execution_id=execution_id,
                    organization_id=org_id,
                    user_id=user_id,
                    agent_id=agent_id,
                    conversation_id=conversation_id,
                    step_type=step_type,
                    step_name=step_name,
                    status=status,
                    input_json=compact_json(input_data),
                    output_json=compact_json(output_data),
                    duration_ms=duration_ms,
                )
            )
            await self.db.commit()
        except Exception as exc:  # noqa: BLE001 - D5 监控降级：恢复事务状态后吞掉
            await self.db.rollback()
            self._quiet_commit(exc)

    async def record_usage(
        self,
        *,
        execution_id: str,
        org_id: int,
        agent_id: int,
        conversation_id: int,
        provider: str,
        model: str,
        round: int,
        usage: dict | None,
        latency_ms: int,
    ) -> None:
        try:
            usage = usage or {}
            await self.repo.add_usage(
                LLMUsageLog(
                    execution_id=execution_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    conversation_id=conversation_id,
                    provider=provider,
                    model=model,
                    input_tokens=usage.get("prompt_tokens") or 0,
                    output_tokens=usage.get("completion_tokens") or 0,
                    total_tokens=usage.get("total_tokens") or 0,
                    latency_ms=latency_ms,
                    round=round,
                )
            )
            await self.db.commit()
        except Exception as exc:  # noqa: BLE001 - D5 监控降级
            await self.db.rollback()
            self._quiet_commit(exc)

    # ---------- 查询 ----------

    @staticmethod
    def _member_scope(membership: OrganizationMember) -> int | None:
        """member 仅在本人范围内可见（D3）；owner/admin 全组织"""
        return membership.user_id if membership.role.name == "member" else None

    @staticmethod
    def _status_of(error_steps: int) -> str:
        return "error" if error_steps > 0 else "success"

    async def list_executions(
        self,
        org: Organization,
        membership: OrganizationMember,
        agent_id: int | None,
        conversation_id: int | None,
        status: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[ExecutionSummary], int]:
        scope = self._member_scope(membership)
        total = await self.repo.count_executions(
            org.id, scope, agent_id, conversation_id, status
        )
        rows = await self.repo.list_executions(
            org.id, scope, agent_id, conversation_id, status, limit, offset
        )
        items = [
            ExecutionSummary(
                execution_id=row[0],
                started_at=row[1],
                finished_at=row[2],
                agent_id=row[3],
                conversation_id=row[4],
                user_id=row[5],
                step_count=row[6],
                duration_ms=row[7],
                error_steps=row[8],
                total_tokens=row[9],
                llm_latency_ms=row[10],
                agent_name=row[11],
                status=self._status_of(row[8]),
            )
            for row in rows
        ]
        return items, total

    async def get_execution(
        self,
        org: Organization,
        membership: OrganizationMember,
        execution_id: str,
    ) -> ExecutionDetail:
        """执行详情：汇总从步骤/用量原位计算；无可见步骤 → 404（含跨组织与 member 越权，D3）"""
        scope = self._member_scope(membership)
        steps = await self.repo.get_steps(execution_id, org.id, scope)
        if not steps:
            raise ExecutionNotFound()
        usages = await self.repo.get_usages(execution_id, org.id)

        agent_name: str | None = None
        agent = await self.db.get(Agent, steps[0].agent_id)
        if agent is not None:
            agent_name = agent.name

        error_steps = sum(1 for s in steps if s.status == "error")
        return ExecutionDetail(
            execution_id=execution_id,
            started_at=steps[0].created_at,
            finished_at=steps[-1].created_at,
            agent_id=steps[0].agent_id,
            conversation_id=steps[0].conversation_id,
            user_id=steps[0].user_id,
            step_count=len(steps),
            duration_ms=sum(s.duration_ms for s in steps),
            error_steps=error_steps,
            total_tokens=sum(u.total_tokens for u in usages),
            llm_latency_ms=sum(u.latency_ms for u in usages),
            agent_name=agent_name,
            status=self._status_of(error_steps),
            steps=[
                ExecutionStepItem(
                    id=s.id,
                    step_type=s.step_type,
                    step_name=s.step_name,
                    status=s.status,
                    input_json=s.input_json,
                    output_json=s.output_json,
                    duration_ms=s.duration_ms,
                    created_at=s.created_at,
                )
                for s in steps
            ],
            usages=[
                LLMUsageItem(
                    id=u.id,
                    provider=u.provider,
                    model=u.model,
                    round=u.round,
                    input_tokens=u.input_tokens,
                    output_tokens=u.output_tokens,
                    total_tokens=u.total_tokens,
                    latency_ms=u.latency_ms,
                    created_at=u.created_at,
                )
                for u in usages
            ],
        )