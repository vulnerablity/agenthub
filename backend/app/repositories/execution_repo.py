# repositories/execution_repo.py
# agent_execution_logs / llm_usage_logs 数据访问层（Service 层不直接写 SQL）
# D1：execution 无主表，列表以 execution_id 分组聚合；D3：member 范围以 user_id 过滤
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, ExecutionStep, LLMUsageLog


class ExecutionRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---------- 写入 ----------

    async def add_step(self, step: ExecutionStep) -> None:
        self.db.add(step)

    async def add_usage(self, usage: LLMUsageLog) -> None:
        self.db.add(usage)

    # ---------- 列表聚合（D1：GROUP BY execution_id，D3：member 追加 user_id 条件） ----------

    @staticmethod
    def _usage_subquery():
        """llm_usage_logs 按 execution 预聚合（多轮 tool-calling 求和），避免 join 行放大"""
        return (
            select(
                LLMUsageLog.execution_id.label("execution_id"),
                func.coalesce(func.sum(LLMUsageLog.total_tokens), 0).label(
                    "total_tokens"
                ),
                func.coalesce(func.sum(LLMUsageLog.latency_ms), 0).label(
                    "llm_latency_ms"
                ),
            )
            .group_by(LLMUsageLog.execution_id)
            .subquery()
        )

    async def count_executions(
        self,
        org_id: int,
        user_id: int | None = None,
        agent_id: int | None = None,
        conversation_id: int | None = None,
        status: str | None = None,
    ) -> int:
        """execution 总数（与列表同条件；status 为聚合态，HAVING 过滤）"""
        error_steps = func.sum(
            case((ExecutionStep.status == "error", 1), else_=0)
        ).label("error_steps")
        stmt = (
            select(func.count(func.distinct(ExecutionStep.execution_id)))
            .where(ExecutionStep.organization_id == org_id)
            .group_by(ExecutionStep.execution_id)
        )
        if user_id is not None:
            stmt = stmt.where(ExecutionStep.user_id == user_id)
        if agent_id is not None:
            stmt = stmt.where(ExecutionStep.agent_id == agent_id)
        if conversation_id is not None:
            stmt = stmt.where(ExecutionStep.conversation_id == conversation_id)
        if status == "error":
            stmt = stmt.having(error_steps > 0)
        elif status == "success":
            stmt = stmt.having(error_steps == 0)
        # count(distinct) 需在聚合（分组）之上再套一层
        result = await self.db.execute(
            select(func.count()).select_from(stmt.subquery())
        )
        return result.scalar_one() or 0

    async def list_executions(
        self,
        org_id: int,
        user_id: int | None = None,
        agent_id: int | None = None,
        conversation_id: int | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[tuple]:
        """execution 聚合列表：返回按最新步骤倒序的 (execution_id, started_at, finished_at,
        agent_id, agent_name, conversation_id, user_id, steps_count, duration_ms, error_steps,
        total_tokens, llm_latency_ms)；agent_name 经 LEFT JOIN（Agent 可能已被硬删除，D4）"""
        usage_subq = self._usage_subquery()
        stmt = (
            select(
                ExecutionStep.execution_id,
                func.min(ExecutionStep.created_at),
                func.max(ExecutionStep.created_at),
                func.max(ExecutionStep.agent_id),
                func.max(ExecutionStep.conversation_id),
                func.max(ExecutionStep.user_id),
                func.count(ExecutionStep.id),
                func.coalesce(func.sum(ExecutionStep.duration_ms), 0),
                error_steps := func.sum(
                    case((ExecutionStep.status == "error", 1), else_=0)
                ).label("error_steps"),
                func.coalesce(usage_subq.c.total_tokens, 0),
                func.coalesce(usage_subq.c.llm_latency_ms, 0),
                # LEFT JOIN agents 仅取名称（审计数据落在 Agent 已删除场景为 None）
                func.max(Agent.name),
            )
            .outerjoin(
                usage_subq, usage_subq.c.execution_id == ExecutionStep.execution_id
            )
            .outerjoin(Agent, Agent.id == ExecutionStep.agent_id)
            .where(ExecutionStep.organization_id == org_id)
            .group_by(
                ExecutionStep.execution_id,
                usage_subq.c.total_tokens,
                usage_subq.c.llm_latency_ms,
                Agent.name,
            )
            .order_by(func.max(ExecutionStep.id).desc())
            .limit(limit)
            .offset(offset)
        )
        if user_id is not None:
            stmt = stmt.where(ExecutionStep.user_id == user_id)
        if agent_id is not None:
            stmt = stmt.where(ExecutionStep.agent_id == agent_id)
        if conversation_id is not None:
            stmt = stmt.where(ExecutionStep.conversation_id == conversation_id)
        if status == "error":
            stmt = stmt.having(error_steps > 0)
        elif status == "success":
            stmt = stmt.having(error_steps == 0)
        result = await self.db.execute(stmt)
        return [tuple(row) for row in result.all()]

    # ---------- 详情 ----------

    async def get_steps(
        self, execution_id: str, org_id: int, user_id: int | None = None
    ) -> list[ExecutionStep]:
        """execution 全部步骤（时间序）；member 追加 user_id 条件（D3）"""
        stmt = (
            select(ExecutionStep)
            .where(
                ExecutionStep.execution_id == execution_id,
                ExecutionStep.organization_id == org_id,
            )
            .order_by(ExecutionStep.id.asc())
        )
        if user_id is not None:
            stmt = stmt.where(ExecutionStep.user_id == user_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_usages(self, execution_id: str, org_id: int) -> list[LLMUsageLog]:
        """execution 的 LLM 调用记录（轮次序）"""
        result = await self.db.execute(
            select(LLMUsageLog)
            .where(
                LLMUsageLog.execution_id == execution_id,
                LLMUsageLog.organization_id == org_id,
            )
            .order_by(LLMUsageLog.round.asc(), LLMUsageLog.id.asc())
        )
        return list(result.scalars().all())
