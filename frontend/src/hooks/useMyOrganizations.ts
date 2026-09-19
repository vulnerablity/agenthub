// hooks/useMyOrganizations.ts
// 我的组织列表查询：登录后由布局组织切换器与组织列表页共用
import { useQuery } from '@tanstack/react-query'

import { organizationApi } from '@/api'

export const MY_ORGS_QUERY_KEY = ['orgs', 'list'] as const

export function useMyOrganizations(enabled = true) {
  return useQuery({
    queryKey: MY_ORGS_QUERY_KEY,
    queryFn: async () => (await organizationApi.list()).data,
    enabled,
    // 401 交由 http 拦截器统一处理
    retry: false,
  })
}