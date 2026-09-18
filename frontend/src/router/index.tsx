// router/index.tsx
// 全应用路由表：公开页（登录/注册）与受保护区域
import { createBrowserRouter } from 'react-router-dom'

import { ROUTE_PATHS } from '@/constants/routes'
import Home from '@/pages/Home'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import RequireAuth from './RequireAuth'

export const router = createBrowserRouter([
  { path: ROUTE_PATHS.LOGIN, element: <Login /> },
  { path: ROUTE_PATHS.REGISTER, element: <Register /> },
  {
    element: <RequireAuth />,
    children: [{ path: ROUTE_PATHS.HOME, element: <Home /> }],
  },
])