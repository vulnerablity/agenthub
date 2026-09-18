// pages/Home.tsx
// 登录后占位首页：展示当前用户与组织角色，后续业务模块在此扩展
import { useNavigate } from 'react-router-dom'

import { ROUTE_PATHS } from '@/constants/routes'
import { useMe } from '@/hooks/useMe'
import { useAuthStore } from '@/stores/auth'
import { queryClient } from '@/utils/query-client'
import { clearTokens } from '@/utils/token'

export default function Home() {
  const navigate = useNavigate()
  const signOut = useAuthStore((state) => state.signOut)
  const { data: me, isPending } = useMe()

  const handleLogout = () => {
    clearTokens()
    queryClient.clear()
    signOut()
    navigate(ROUTE_PATHS.LOGIN, { replace: true })
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-neutral-900">AgentHub</h1>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
        >
          退出登录
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {isPending ? (
          <p className="text-sm text-neutral-500">加载中…</p>
        ) : me ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
            <h2 className="text-base font-semibold text-neutral-900">
              {me.username}
              <span className="ml-2 text-sm font-normal text-neutral-500">{me.email}</span>
            </h2>
            <div className="mt-6">
              <h3 className="text-sm font-medium text-neutral-700">所属组织</h3>
              {me.organizations.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-2">
                  {me.organizations.map((org) => (
                    <li
                      key={org.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 text-sm"
                    >
                      <span className="text-neutral-900">{org.name}</span>
                      <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700">
                        {org.role}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">暂无组织</p>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}