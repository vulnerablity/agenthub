// hooks/useOrgMembers.ts
// 组织成员列表查询：名称/邮箱搜索词变化即重新拉取
import { useQuery } from '@tanstack/react-query'

import { organizationApi } from '@/api'

export const orgMembersQueryKey = (orgId: number, email: string | undefined) =>
  ['org', orgId, 'members', email ?? ''] as const

export function useOrgMembers(
  orgId: number | null,
  search?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: orgMembersQueryKey(orgId ?? 0, search),
    queryFn: async () => (await organizationApi.listMembers(orgId!, search)).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}
