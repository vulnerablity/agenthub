// hooks/useConversation.ts
// 单个会话详情查询（含 Agent 名与版本快照信息）
import { useQuery } from '@tanstack/react-query'

import { conversationApi } from '@/api'

export const conversationQueryKey = (orgId: number, conversationId: number) =>
  ['org', orgId, 'conversation', conversationId] as const

export function useConversation(
  orgId: number | null,
  conversationId: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: conversationQueryKey(orgId ?? 0, conversationId ?? 0),
    queryFn: async () => (await conversationApi.get(conversationId!)).data,
    enabled: enabled && orgId != null && conversationId != null,
    retry: false,
  })
}