// hooks/useConversations.ts
// 会话列表查询（组织隔离经请求头），当前用户自己的会话
import { useQuery } from '@tanstack/react-query'

import { conversationApi } from '@/api'

export const conversationsQueryKey = (orgId: number, search = '') =>
  ['org', orgId, 'conversations', search] as const

export function useConversations(orgId: number | null, enabled = true, search = '') {
  return useQuery({
    queryKey: conversationsQueryKey(orgId ?? 0, search),
    queryFn: async () => (await conversationApi.list(search ? { search } : undefined)).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}
