// hooks/useOrgMembers.ts
// 组织成员列表查询：email 变化即重新拉取（后端按邮箱模糊过滤）
import { useQuery } from '@tanstack/react-query'

import { organizationApi } from '@/api'

export const orgMembersQueryKey = (orgId: number, email: string | undefined) =>
  ['org', orgId, 'members', email ?? ''] as const

export function useOrgMembers(
  orgId: number | null,
  email?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: orgMembersQueryKey(orgId ?? 0, email),
    queryFn: async () => (await organizationApi.listMembers(orgId!, email)).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}