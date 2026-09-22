// types/tool.ts
// 工具协议类型：与 backend/app/schemas/tool.py 一一对应（需求文档 3.7 / 4.6 / 4.7）
export type ToolType = 'calculator' | 'http'

export interface ToolCreateRequest {
  name: string
  description?: string | null
  type: ToolType
  /** 传给 LLM 的 input JSON Schema（function.parameters） */
  schema: Record<string, unknown>
  /** 执行器固定配置（http 有 url/method/headers/body；calculator 为 null） */
  config?: Record<string, unknown> | null
}

export interface ToolUpdateRequest {
  name?: string
  description?: string | null
  schema?: Record<string, unknown>
  config?: Record<string, unknown> | null
}

export interface ToolDetail {
  id: number
  name: string
  description: string | null
  type: ToolType
  schema: Record<string, unknown>
  config: Record<string, unknown> | null
  status: string
  created_at: string
  updated_at: string
}

export interface ToolTestRequest {
  arguments: Record<string, unknown>
}

export interface ToolTestResponse {
  status: 'ok' | 'error'
  output: string
  error: string | null
  duration_ms: number
}

export interface AgentToolDetail {
  id: number
  agent_id: number
  tool_id: number
  tool_name: string
  tool_type: ToolType
  tool_description: string | null
  enabled: boolean
  config_json: Record<string, unknown> | null
  created_at: string
}

export interface AgentToolBindRequest {
  tool_id: number
  enabled?: boolean
  config_json?: Record<string, unknown> | null
}

/** SSE 单次工具调用轨迹（tool_call / tool_result 事件与 done.tool_calls、metadata 共用） */
export interface ToolCallRun {
  round: number
  name: string
  arguments: Record<string, unknown>
  status: 'ok' | 'error'
  output: string
  error: string | null
}