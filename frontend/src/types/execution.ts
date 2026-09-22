// types/execution.ts
// 执行监控类型：与后端 /api/v1/executions 对齐（execution.md：列表为 execution_id 分组聚合，详情含链路）
export type ExecutionStepType = 'llm' | 'rag' | 'tool'
export type ExecutionStatus = 'success' | 'error'

export interface ExecutionStep {
  id: number
  step_type: ExecutionStepType
  step_name: string
  status: ExecutionStatus
  input_json: Record<string, unknown> | null
  output_json: Record<string, unknown> | null
  duration_ms: number
  created_at: string
}

export interface LLMUsage {
  id: number
  provider: string
  model: string
  round: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  latency_ms: number
  created_at: string
}

export interface ExecutionSummary {
  execution_id: string
  agent_id: number
  agent_name: string | null
  conversation_id: number
  user_id: number
  started_at: string
  finished_at: string
  duration_ms: number
  step_count: number
  error_steps: number
  status: ExecutionStatus
  total_tokens: number
  llm_latency_ms: number
}

export interface ExecutionDetail extends ExecutionSummary {
  steps: ExecutionStep[]
  usages: LLMUsage[]
}

export interface ExecutionListResponse {
  items: ExecutionSummary[]
  total: number
}

export interface ExecutionListParams {
  agent_id?: number
  conversation_id?: number
  status?: ExecutionStatus
  limit?: number
  offset?: number
}