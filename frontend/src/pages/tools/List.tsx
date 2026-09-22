// pages/tools/List.tsx
// 工具列表：卡片网格（名称/类型/描述/更新时间）+ 新建/删除入口（tool-calling.md 3.3 权限矩阵）
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { toolDetailPath, toolNewPath } from '@/constants/routes'
import { useDeleteTool, useTools } from '@/hooks/useTools'
import { useOrg } from '@/hooks/useOrg'

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  calculator: { label: '计算器', className: 'bg-indigo-50 text-indigo-700' },
  http: { label: 'HTTP', className: 'bg-emerald-50 text-emerald-700' },
}

export default function ToolList() {
  const { orgId: orgIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null

  const navigate = useNavigate()
  const { data: org } = useOrg(orgId)
  const { data: tools, isPending } = useTools(orgId)
  const [apiError, setApiError] = useState('')
  const canManage = canManageAgent(org?.my_role)

  const deleteMutation = useDeleteTool(orgId ?? 0)
  const handleDelete = (toolId: number, name: string) => {
    setApiError('')
    if (window.confirm(`确定删除工具「${name}」？已绑定智能体的关联将一并解除。`)) {
      deleteMutation.mutate(toolId, { onError: (error) => setApiError(errorMessage(error)) })
    }
  }

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">工具</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {org ? `${org.name} · Agent 可调用的外部工具（计算器 / HTTP）` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(toolNewPath(orgId))}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            新建工具
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : tools && tools.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => {
            const badge = TYPE_BADGES[tool.type] ?? {
              label: tool.type,
              className: 'bg-neutral-100 text-neutral-600',
            }
            return (
              <li
                key={tool.id}
                className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-neutral-900">
                      {tool.name}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-8 text-xs text-neutral-500">
                    {tool.description || '暂无描述'}
                  </p>
                  <p className="mt-3 text-xs text-neutral-400">
                    更新于 {new Date(tool.updated_at).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(toolDetailPath(orgId, tool.id))}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
                  >
                    查看 / 测试
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={deleteMutation.isPending && deleteMutation.variables === tool.id}
                      onClick={() => handleDelete(tool.id, tool.name)}
                      className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deleteMutation.isPending && deleteMutation.variables === tool.id
                        ? '删除中…'
                        : '删除'}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            {canManage
              ? '尚未创建工具，点击右上角「新建工具」添加计算器或 HTTP 工具'
              : '该组织暂无工具'}
          </p>
        </div>
      )}
    </div>
  )
}