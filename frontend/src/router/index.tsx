// router/index.tsx
// 全应用路由表：公开页（登录/注册）与受保护区域（AppLayout 内业务页）
import { createBrowserRouter } from 'react-router-dom'

import AppLayout from '@/components/layout/AppLayout'
import { ROUTE_PATHS } from '@/constants/routes'
import Home from '@/pages/Home'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import OrganizationList from '@/pages/organizations/List'
import Members from '@/pages/organizations/Members'
import Settings from '@/pages/organizations/Settings'
import RequireAuth from './RequireAuth'

export const router = createBrowserRouter([
  { path: ROUTE_PATHS.LOGIN, element: <Login /> },
  { path: ROUTE_PATHS.REGISTER, element: <Register /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTE_PATHS.HOME, element: <Home /> },
          { path: ROUTE_PATHS.ORGANIZATIONS, element: <OrganizationList /> },
          { path: ROUTE_PATHS.ORG_MEMBERS, element: <Members /> },
          { path: ROUTE_PATHS.ORG_SETTINGS, element: <Settings /> },
        ],
      },
    ],
  },
])