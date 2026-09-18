// router/RequireAuth.tsx
// 路由守卫：未登录跳转登录页并记录来源地址，登录后回跳
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { ROUTE_PATHS } from '@/constants/routes'
import { useAuthStore } from '@/stores/auth'

export default function RequireAuth() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return (
      <Navigate
        to={ROUTE_PATHS.LOGIN}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }
  return <Outlet />
}