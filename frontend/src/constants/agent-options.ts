// constants/agent-options.ts
// 智能体常量：状态中文文案、常用 Provider 候选项与角色可见性纯函数
import type { AgentStatus } from '@/types'

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  enabled: '已启用',
  disabled: '已停用',
}

/** 常用 LLM Provider 候选项（D3：后端不枚举，前端 datalist 快速输入） */
export const PROVIDER_OPTIONS = ['openai', 'anthropic', 'zhipu', 'deepseek'] as const

/** 管理能力收敛：owner/admin 可新建/编辑/启停/删除，member/viewer 只读（后端为准） */
export function canManageAgent(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin'
}