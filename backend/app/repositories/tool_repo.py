# repositories/tool_repo.py
# tools / agent_tools 数据访问层（Service 层不直接写 SQL）
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgentTool, Tool


class ToolRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---------- Tool ----------

    async def get_tool(self, tool_id: int) -> Tool | None:
        return await self.db.get(Tool, tool_id)

    async def name_exists(self, org_id: int, name: str) -> bool:
        """组织内名称占用检查（唯一约束预查，tool-calling.md D02）"""
        result = await self.db.execute(
            select(Tool.id)
            .where(Tool.organization_id == org_id, Tool.name == name)
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def create_tool(self, tool: Tool) -> Tool:
        self.db.add(tool)
        await self.db.flush()
        return tool

    async def list_by_org(self, org_id: int) -> list[Tool]:
        """组织内工具列表（最近更新在前）"""
        result = await self.db.execute(
            select(Tool)
            .where(Tool.organization_id == org_id)
            .order_by(Tool.updated_at.desc(), Tool.id.desc())
        )
        return list(result.scalars().all())

    async def delete_tool(self, tool: Tool) -> None:
        """删除工具（agent_tools 绑定随外键 CASCADE 清理，D04）"""
        await self.db.delete(tool)

    async def delete_by_org(self, org_id: int) -> None:
        """解散组织前清空其全部工具（tool-calling.md 2.8）"""
        await self.db.execute(delete(Tool).where(Tool.organization_id == org_id))

    # ---------- AgentTool ----------

    async def get_binding(self, agent_id: int, tool_id: int) -> AgentTool | None:
        result = await self.db.execute(
            select(AgentTool).where(
                AgentTool.agent_id == agent_id, AgentTool.tool_id == tool_id
            )
        )
        return result.scalar_one_or_none()

    async def create_binding(self, binding: AgentTool) -> AgentTool:
        self.db.add(binding)
        await self.db.flush()
        return binding

    async def list_bindings_with_tool(self, agent_id: int) -> list[tuple[AgentTool, Tool]]:
        """智能体已绑定列表（join 工具信息，供详情展示与对话工具加载）"""
        result = await self.db.execute(
            select(AgentTool, Tool)
            .join(Tool, Tool.id == AgentTool.tool_id)
            .where(AgentTool.agent_id == agent_id)
            .order_by(AgentTool.id.asc())
        )
        return [(binding, tool) for binding, tool in result.all()]

    async def delete_binding(self, binding: AgentTool) -> None:
        await self.db.delete(binding)