// hooks/useMe.ts
// 当前用户信息查询（含所属组织与角色），登录后由页面按需触发
import { useQuery } from '@tanstack/react-query'

import { authApi } from '@/api'

export const ME_QUERY_KEY = ['auth', 'me'] as const

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => (await authApi.getMe()).data,
    enabled,
    // 401 交由 http 拦截器统一处理，这里不额外重试
    retry: false,
  })
}