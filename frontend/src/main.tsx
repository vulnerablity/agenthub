// main.tsx
// 应用装配：注册 401 全局登出回调，挂载 React Query 与路由
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'

import './index.css'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useOrganizationStore } from '@/stores/organization'
import { setOnUnauthorized } from '@/utils/http'
import { queryClient } from '@/utils/query-client'
import { clearTokens } from '@/utils/token'

// 拦截器刷新失败时：清 Token、清缓存、清组织上下文、置登出态（路由守卫随状态跳转登录页）
setOnUnauthorized(() => {
  clearTokens()
  queryClient.clear()
  useOrganizationStore.getState().setCurrentOrg(null)
  useAuthStore.getState().signOut()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)