// types/agent.ts
// 智能体协议类型：与 backend/app/schemas/agent.py 一一对应（需求文档 3.3 / 3.4 / 4.4 / 4.5）
export type AgentStatus = 'enabled' | 'disabled'

export interface AgentCreateRequest {
  name: string
  description?: string | null
  avatar_url?: string | null
  status?: AgentStatus
  system_prompt?: string
  model_provider: string
  model_name: string
  temperature?: number | null
  max_tokens?: number | null
  config_json?: Record<string, unknown> | null
}

export interface AgentUpdateRequest {
  name?: string | null
  description?: string | null
  avatar_url?: string | null
}

export interface AgentStatusRequest {
  status: AgentStatus
}

export interface AgentListItem {
  id: number
  name: string
  description: string | null
  avatar_url: string | null
  status: AgentStatus
  current_version: number | null
  created_at: string
  updated_at: string
}

export interface AgentVersionCreateRequest {
  system_prompt?: string
  model_provider: string
  model_name: string
  /** 绑定的模型供应商 id（model-providers.md D2）：null/缺省 = 全局默认（走 LLM_API_BASE） */
  provider_id?: number | null
  temperature?: number | null
  max_tokens?: number | null
  config_json?: Record<string, unknown> | null
}

export interface AgentVersionItem {
  id: number
  version: number
  system_prompt: string
  model_provider: string
  model_name: string
  /** 路由真源（D2/D3）：null = 全局回落；model_provider 仅为建版本时的名称快照 */
  provider_id: number | null
  temperature: number | null
  max_tokens: number | null
  config_json: Record<string, unknown> | null
  created_by_username: string
  created_at: string
  is_current: boolean
}

export interface AgentDetail {
  id: number
  name: string
  description: string | null
  avatar_url: string | null
  status: AgentStatus
  current_version: number | null
  current_version_detail: AgentVersionItem | null
  created_by_username: string
  created_at: string
  updated_at: string
}