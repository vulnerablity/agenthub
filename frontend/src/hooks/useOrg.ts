// hooks/useOrg.ts
// 单个组织详情查询（含我的角色），orgId 来自页面 URL 参数
import { useQuery } from '@tanstack/react-query'

import { organizationApi } from '@/api'

export const orgQueryKey = (orgId: number) => ['org', orgId] as const

export function useOrg(orgId: number | null, enabled = true) {
  return useQuery({
    queryKey: orgQueryKey(orgId ?? 0),
    queryFn: async () => (await organizationApi.get(orgId!)).data,
    enabled: enabled && orgId != null,
    retry: false,
  })
}