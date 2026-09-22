// types/chat.ts
// 对话协议类型：与 backend/app/schemas/chat.py 一一对应（需求文档 3.5 / 4.11 / 4.12）
import type { RAGSource } from './knowledge'
import type { ToolCallRun } from './tool'
export interface ConversationCreateRequest {
  agent_id: number
  title?: string | null
}

export interface ConversationDetail {
  id: number
  agent_id: number
  agent_name: string
  agent_avatar_url: string | null
  agent_version_id: number | null
  title: string
  created_at: string
  updated_at: string
}

export interface ConversationListItem {
  id: number
  agent_id: number
  agent_name: string
  agent_avatar_url: string | null
  title: string
  last_message_preview: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export type ChatRole = 'user' | 'assistant'

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface MessageDetail {
  id: number
  conversation_id: number
  role: ChatRole
  content: string
  token_usage: TokenUsage | null
  metadata_json: Record<string, unknown> | null
  created_at: string
}

/** SSE done 事件载荷：LLM 空输出时 message_id 为 null（chat.md D13）；sources 为 RAG 引用来源（knowledge.md D11）；tool_calls 为工具调用轨迹（tool-calling.md 2.7） */
export interface SseDonePayload {
  message_id: number | null
  token_usage: TokenUsage | null
  sources: RAGSource[]
  tool_calls: ToolCallRun[]
}

/** SSE error 事件载荷：流中失败（流前失败走统一 JSON 错误） */
export interface SseErrorPayload {
  code: string
  message: string
}

/** SSE tool_call 事件载荷：LLM 请求了一次工具调用（tool-calling.md 2.7） */
export interface SseToolCallPayload {
  round: number
  name: string
  arguments: Record<string, unknown>
}

/** SSE tool_result 事件载荷：一次工具执行的收尾（tool-calling.md 2.7） */
export interface SseToolResultPayload {
  round: number
  name: string
  status: 'ok' | 'error'
  output: string
}