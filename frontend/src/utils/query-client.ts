// utils/query-client.ts
// 全局 React Query 客户端：默认新鲜期 30s、不随窗口聚焦自动刷新
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})