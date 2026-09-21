// types/chat.ts
// 对话协议类型：与 backend/app/schemas/chat.py 一一对应（需求文档 3.5 / 4.11 / 4.12）
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

/** SSE done 事件载荷：LLM 空输出时 message_id 为 null（chat.md D13） */
export interface SseDonePayload {
  message_id: number | null
  token_usage: TokenUsage | null
}

/** SSE error 事件载荷：流中失败（流前失败走统一 JSON 错误） */
export interface SseErrorPayload {
  code: string
  message: string
}