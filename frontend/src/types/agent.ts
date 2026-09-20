// types/agent.ts
// 智能体协议类型：与 backend/app/schemas/agent.py 一一对应
export type AgentStatus = 'enabled' | 'disabled'

export interface AgentCreateRequest {
  name: string
  description?: string | null
  provider: string
  model: string
  temperature?: number | null
  max_tokens?: number | null
  system_prompt?: string
}

export interface AgentUpdateRequest {
  name?: string | null
  description?: string | null
  provider?: string | null
  model?: string | null
  temperature?: number | null
  max_tokens?: number | null
  system_prompt?: string | null
}

export interface AgentStatusRequest {
  status: AgentStatus
}

export interface AgentListItem {
  id: number
  name: string
  description: string | null
  provider: string
  model: string
  status: AgentStatus
  updated_at: string
}

export interface AgentDetail {
  id: number
  name: string
  description: string | null
  system_prompt: string
  provider: string
  model: string
  temperature: number | null
  max_tokens: number | null
  status: AgentStatus
  created_by_username: string
  created_at: string
  updated_at: string
}