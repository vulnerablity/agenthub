// pages/agents/List.tsx
// 智能体列表：搜索与状态过滤 + 卡片网格 + 新建入口；管理操作（启停/编辑）按角色矩阵渲染（后端为准）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { agentApi } from '@/api'
import TextField from '@/components/form/TextField'
import { AGENT_STATUS_LABELS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { agentDetailPath, agentEditPath, agentNewPath } from '@/constants/routes'
import { agentsQueryKey, useAgents } from '@/hooks/useAgents'
import { useOrg } from '@/hooks/useOrg'
import type { AgentStatus } from '@/types'

type StatusFilter = 'all' | AgentStatus

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
]

export default function AgentList() {
  const { orgId: orgIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const { data: agents, isPending } = useAgents(orgId, {
    name: name || undefined,
    status: status === 'all' ? undefined : status,
  })
  const [apiError, setApiError] = useState('')

  const canManage = canManageAgent(org?.my_role)

  /** 启停/删除后刷新列表（queryKey 按当前过滤条件精确失效） */
  const refreshList = () =>
    queryClient.invalidateQueries({
      queryKey: agentsQueryKey(orgId ?? 0, {
        name: name || undefined,
        status: status === 'all' ? undefined : status,
      }),
    })

  const toggleStatus = useMutation({
    mutationFn: ({ agentId, status: next }: { agentId: number; status: AgentStatus }) =>
      agentApi.setStatus(orgId!, agentId, { status: next }),
    onSuccess: refreshList,
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  const handleToggle = (agentId: number, current: AgentStatus) => {
    setApiError('')
    toggleStatus.mutate({ agentId, status: current === 'enabled' ? 'disabled' : 'enabled' })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">智能体管理</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {org ? `${org.name} · 智能体配置与生命周期管理` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(agentNewPath(orgId))}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            新建智能体
          </button>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <TextField
            label="搜索智能体"
            type="search"
            placeholder="按名称模糊搜索"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="agent-status-filter" className="text-sm font-medium text-neutral-700">
            状态
          </label>
          <select
            id="agent-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-xs text-neutral-400">
          {agents ? `共 ${agents.length} 个` : ''}
        </p>
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : agents && agents.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const isEnabled = agent.status === 'enabled'
            const toggling = toggleStatus.isPending && toggleStatus.variables?.agentId === agent.id
            return (
              <li
                key={agent.id}
                className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-base font-semibold text-neutral-900">
                      {agent.name}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-3 py-0.5 text-xs font-medium ${
                        isEnabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      {AGENT_STATUS_LABELS[agent.status]}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-8 text-xs text-neutral-500">
                    {agent.description || '暂无描述'}
                  </p>
                  <p className="mt-3 text-xs text-neutral-400">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
                      {agent.provider}
                    </span>
                    <span className="mx-1.5">/</span>
                    <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono">
                      {agent.model}
                    </span>
                  </p>
                  <p className="mt-3 text-xs text-neutral-400">
                    更新于 {new Date(agent.updated_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(agentDetailPath(orgId, agent.id))}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition hover:bg-neutral-100"
                  >
                    查看
                  </button>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => navigate(agentEditPath(orgId, agent.id))}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition hover:bg-neutral-100"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={toggling}
                        onClick={() => handleToggle(agent.id, agent.status)}
                        className={`ml-auto rounded-lg px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          isEnabled
                            ? 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                            : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        {toggling ? '…' : isEnabled ? '停用' : '启用'}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            {name || status !== 'all'
              ? '没有匹配的智能体'
              : canManage
                ? '尚未创建智能体，点击右上角「新建智能体」开始配置'
                : '该组织暂无智能体'}
          </p>
        </div>
      )}
    </div>
  )
}