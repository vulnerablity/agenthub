// pages/agents/Detail.tsx
// 智能体详情：页头操作（启停/编辑）+ 双列配置/提示词 + 删除危险区（输名称确认）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { agentApi } from '@/api'
import { AGENT_STATUS_LABELS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { agentEditPath, agentsPath } from '@/constants/routes'
import { useAgent } from '@/hooks/useAgent'
import { useOrg } from '@/hooks/useOrg'

export default function AgentDetail() {
  const { orgId: orgIdParam, agentId: agentIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const agentId = agentIdParam ? Number(agentIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: agent, isPending } = useAgent(orgId, agentId)
  const [apiError, setApiError] = useState('')
  const [confirmName, setConfirmName] = useState('')

  const canManage = canManageAgent(org?.my_role)

  /** 启停/删除后刷新详情与列表（列表按前缀失效） */
  const refreshAfterChange = async () => {
    await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agent', agentId] })
    await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agents'] })
  }

  const toggleStatus = useMutation({
    mutationFn: () =>
      agentApi.setStatus(orgId!, agentId!, {
        status: agent!.status === 'enabled' ? 'disabled' : 'enabled',
      }),
    onSuccess: refreshAfterChange,
    onError: (error) => setApiError(errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => agentApi.remove(orgId!, agentId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agents'] })
      await queryClient.removeQueries({ queryKey: ['org', orgId, 'agent', agentId] })
      navigate(agentsPath(orgId!))
    },
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || agentId == null || Number.isNaN(orgId) || Number.isNaN(agentId)) {
    return <p className="text-sm text-neutral-500">参数无效</p>
  }

  if (isPending) {
    return <p className="text-sm text-neutral-500">加载中…</p>
  }

  if (!agent) {
    return <p className="text-sm text-neutral-500">智能体不存在</p>
  }

  const isEnabled = agent.status === 'enabled'
  const deleteDisabled = confirmName !== agent.name || deleteMutation.isPending

  return (
    <div className="mx-auto max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(agentsPath(orgId))}
        className="text-sm text-neutral-500 transition hover:text-neutral-700"
      >
        ← 返回智能体列表
      </button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-neutral-900">{agent.name}</h2>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-medium ${
              isEnabled
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            {AGENT_STATUS_LABELS[agent.status]}
          </span>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={toggleStatus.isPending}
              onClick={() => {
                setApiError('')
                toggleStatus.mutate()
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isEnabled
                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                  : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              {toggleStatus.isPending ? '…' : isEnabled ? '停用' : '启用'}
            </button>
            <button
              type="button"
              onClick={() => navigate(agentEditPath(orgId, agent.id))}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              编辑
            </button>
          </div>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">模型配置</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-neutral-400">模型</dt>
              <dd className="mt-1 font-mono text-neutral-900">
                {agent.provider} / {agent.model}
              </dd>
            </div>
            <div className="flex gap-8">
              <div>
                <dt className="text-neutral-400">Temperature</dt>
                <dd className="mt-1 font-mono text-neutral-900">
                  {agent.temperature != null ? agent.temperature : '运行时默认'}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">Max Tokens</dt>
                <dd className="mt-1 font-mono text-neutral-900">
                  {agent.max_tokens != null ? agent.max_tokens : '运行时默认'}
                </dd>
              </div>
            </div>
            <div>
              <dt className="text-neutral-400">创建者</dt>
              <dd className="mt-1 text-neutral-900">{agent.created_by_username}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">创建时间</dt>
              <dd className="mt-1 text-neutral-900">
                {new Date(agent.created_at).toLocaleString('zh-CN')}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-400">更新时间</dt>
              <dd className="mt-1 text-neutral-900">
                {new Date(agent.updated_at).toLocaleString('zh-CN')}
              </dd>
            </div>
          </dl>
          {agent.description ? (
            <div className="mt-4 border-t border-neutral-100 pt-4">
              <dt className="text-neutral-400">描述</dt>
              <p className="mt-1 text-sm text-neutral-900">{agent.description}</p>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">系统提示词</h3>
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 font-mono text-sm leading-relaxed text-neutral-800">
            {agent.system_prompt || '（未设置）'}
          </pre>
        </section>
      </div>

      {canManage ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-red-600">危险区</h3>
          <div className="mt-4 border-t border-neutral-100 pt-5">
            <p className="text-sm font-medium text-neutral-900">删除智能体</p>
            <p className="mt-1 text-xs text-neutral-500">
              请输入智能体名称确认，删除后不可恢复
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={agent.name}
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
              />
              <button
                type="button"
                disabled={deleteDisabled}
                onClick={() => {
                  setApiError('')
                  if (window.confirm(`确定删除智能体「${agent.name}」？此操作不可撤销。`)) {
                    deleteMutation.mutate()
                  }
                }}
                className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}