// pages/tools/List.tsx
// 工具列表：卡片网格（名称/类型/描述/更新时间）+ 新建/删除入口（tool-calling.md 3.3 权限矩阵）
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import Icon from '@/components/Icon'
import { canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { toolDetailPath, toolNewPath } from '@/constants/routes'
import { useDeleteTool, useTools } from '@/hooks/useTools'
import { useOrg } from '@/hooks/useOrg'

const TYPE_BADGES: Record<string, { label: string; badge: string; icon: string }> = {
  calculator: { label: '计算器', badge: 'accent', icon: 'zap' },
  http: { label: 'HTTP', badge: 'info', icon: 'globe' },
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
    return <p className="muted">组织参数无效</p>
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">工具</h1>
          <p className="page-sub">
            {org ? `${org.name} · Agent 可调用的外部工具（计算器 / HTTP）` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button type="button" onClick={() => navigate(toolNewPath(orgId))} className="btn primary">
            <Icon name="plus" className="ic" />
            新建工具
          </button>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : tools && tools.length > 0 ? (
        <ul className="grid g2 mt-6 xl:grid-cols-3">
          {tools.map((tool) => {
            const meta = TYPE_BADGES[tool.type] ?? {
              label: tool.type,
              badge: 'off',
              icon: 'wrench',
            }
            return (
              <li key={tool.id} className="card card-pad flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="avatar md av-2">
                    <Icon name={meta.icon as never} width={16} height={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15px] font-bold">{tool.name}</h3>
                      <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] muted">
                      更新于 {new Date(tool.updated_at).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 min-h-9 text-[13px] muted">
                  {tool.description || '暂无描述'}
                </p>
                <div className="row-actions mt-1">
                  <button
                    type="button"
                    onClick={() => navigate(toolDetailPath(orgId, tool.id))}
                    className="btn primary xs"
                  >
                    <Icon name="search" className="ic" />
                    查看 / 测试
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={deleteMutation.isPending && deleteMutation.variables === tool.id}
                      onClick={() => handleDelete(tool.id, tool.name)}
                      className="btn xs danger-ghost ml-auto"
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
        <div className="empty mt-6">
          <Icon name="wrench" className="ic" />
          <p>
            {canManage
              ? '尚未创建工具，点击右上角「新建工具」添加计算器或 HTTP 工具'
              : '该组织暂无工具'}
          </p>
          {canManage ? (
            <div className="actions">
              <button
                type="button"
                onClick={() => navigate(toolNewPath(orgId))}
                className="btn primary sm"
              >
                <Icon name="plus" className="ic" />
                新建工具
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
