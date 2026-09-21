// hooks/useConversations.ts
// 会话列表查询（组织隔离经请求头），当前用户自己的会话
import { useQuery } from '@tanstack/react-query'

import { conversationApi } from '@/api'

export const conversationsQueryKey = (orgId: number) =>
  ['org', orgId, 'conversations'] as const

export function useConversations(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: conversationsQueryKey(orgId ?? 0),
    queryFn: async () => (await conversationApi.list()).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}