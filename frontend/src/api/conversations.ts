// api/conversations.ts
// 对话接口封装：与后端 /api/v1/conversations 对齐（组织隔离经 X-Organization-Id 请求头自动携带）
import { http } from '@/utils/http'
import type {
  ConversationCreateRequest,
  ConversationDetail,
  ConversationListItem,
  MessageDetail,
} from '@/types'

export const conversationApi = {
  create(data: ConversationCreateRequest) {
    return http.post<ConversationDetail>('/conversations', data)
  },
  list(params?: { agent_id?: number; limit?: number; offset?: number }) {
    return http.get<ConversationListItem[]>('/conversations', { params })
  },
  get(conversationId: number) {
    return http.get<ConversationDetail>(`/conversations/${conversationId}`)
  },
  remove(conversationId: number) {
    return http.delete(`/conversations/${conversationId}`)
  },
  listMessages(conversationId: number, params?: { limit?: number; before_id?: number }) {
    return http.get<MessageDetail[]>(`/conversations/${conversationId}/messages`, {
      params,
    })
  },
  sendMessage(conversationId: number, data: { content: string }) {
    return http.post<MessageDetail>(`/conversations/${conversationId}/messages`, data)
  },
}