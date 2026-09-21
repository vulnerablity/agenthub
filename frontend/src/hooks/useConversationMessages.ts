// hooks/useConversationMessages.ts
// 会话历史消息查询（进入会话时加载；流式结束/重进后失效刷新）
import { useQuery } from '@tanstack/react-query'

import { conversationApi } from '@/api'

export const messagesQueryKey = (orgId: number, conversationId: number) =>
  ['org', orgId, 'conversation', conversationId, 'messages'] as const

export function useConversationMessages(
  orgId: number | null,
  conversationId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: messagesQueryKey(orgId ?? 0, conversationId ?? 0),
    queryFn: async () =>
      (await conversationApi.listMessages(conversationId!)).data,
    enabled: enabled && orgId != null && conversationId != null,
    retry: false,
  })
}