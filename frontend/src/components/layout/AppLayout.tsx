// components/layout/AppLayout.tsx
// 受保护区域布局：左侧常驻侧边栏（组织切换器 + 导航 + 用户）+ 右侧内容区 Outlet
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { orgMembersPath, orgSettingsPath, ROUTE_PATHS } from '@/constants/routes'
import { useMe } from '@/hooks/useMe'
import { useAuthStore } from '@/stores/auth'
import { useOrganizationStore } from '@/stores/organization'
import { queryClient } from '@/utils/query-client'
import { clearTokens } from '@/utils/token'

import OrgSwitcher from './OrgSwitcher'

export default function AppLayout() {
  const navigate = useNavigate()
  const signOut = useAuthStore((state) => state.signOut)
  const currentOrgId = useOrganizationStore((state) => state.currentOrgId)
  const setCurrentOrg = useOrganizationStore((state) => state.setCurrentOrg)
  const { data: me } = useMe()

  const handleLogout = () => {
    clearTokens()
    queryClient.clear()
    setCurrentOrg(null)
    signOut()
    navigate(ROUTE_PATHS.LOGIN, { replace: true })
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm transition ${
      isActive
        ? 'bg-indigo-50 font-medium text-indigo-700'
        : 'text-neutral-600 hover:bg-neutral-100'
    }`

  // 组织相关的导航依赖当前组织；无组织时置灰引导创建
  const orgNavDisabled = currentOrgId == null

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white px-4 py-6">
        <h1 className="px-3 text-lg font-semibold text-neutral-900">AgentHub</h1>

        <div className="mt-6">
          <p className="px-3 text-xs font-medium text-neutral-400">当前组织</p>
          <div className="mt-2">
            <OrgSwitcher />
          </div>
        </div>

        <nav className="mt-6 flex flex-col gap-1">
          <NavLink to={ROUTE_PATHS.HOME} end className={navLinkClass}>
            概览
          </NavLink>
          <NavLink to={ROUTE_PATHS.ORGANIZATIONS} className={navLinkClass}>
            我的组织
          </NavLink>
          <div className="my-2 border-t border-neutral-100" />
          {orgNavDisabled ? (
            <span className="cursor-not-allowed rounded-lg px-3 py-2 text-sm text-neutral-300">
              组织设置
            </span>
          ) : (
            <NavLink to={orgSettingsPath(currentOrgId)} className={navLinkClass}>
              组织设置
            </NavLink>
          )}
          {orgNavDisabled ? (
            <span className="cursor-not-allowed rounded-lg px-3 py-2 text-sm text-neutral-300">
              成员管理
            </span>
          ) : (
            <NavLink to={orgMembersPath(currentOrgId)} className={navLinkClass}>
              成员管理
            </NavLink>
          )}
        </nav>

        <div className="mt-auto border-t border-neutral-100 pt-4">
          <div className="px-3">
            <p className="truncate text-sm font-medium text-neutral-900">
              {me?.username ?? '…'}
            </p>
            <p className="truncate text-xs text-neutral-400">{me?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
          >
            退出登录
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}