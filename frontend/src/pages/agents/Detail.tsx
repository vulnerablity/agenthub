// pages/agents/Detail.tsx
// 智能体详情：基础信息 + 当前版本配置 + 版本历史（发布/回滚）+ 删除危险区（需求 3.3/3.4）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { agentApi } from '@/api'
import { AGENT_STATUS_LABELS, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import {
  agentEditPath,
  agentVersionNewPath,
  agentsPath,
} from '@/constants/routes'
import { useAgent, useAgentVersions } from '@/hooks/useAgent'
import { useOrg } from '@/hooks/useOrg'

export default function AgentDetail() {
  const { orgId: orgIdParam, agentId: agentIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const agentId = agentIdParam ? Number(agentIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: agent, isPending } = useAgent(orgId, agentId)
  const { data: versions } = useAgentVersions(orgId, agentId)
  const [apiError, setApiError] = useState('')
  const [confirmName, setConfirmName] = useState('')

  const canManage = canManageAgent(org?.my_role)

  /** 版本流转后刷新详情、版本列表与列表页缓存 */
  const refreshAfterVersionChange = async () => {
    await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agent', agentId] })
    await queryClient.invalidateQueries({
      queryKey: ['org', orgId, 'agent', agentId, 'versions'],
    })
    await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'agents'] })
  }

  const toggleStatus = useMutation({
    mutationFn: () =>
      agentApi.setStatus(agentId!, {
        status: agent!.status === 'enabled' ? 'disabled' : 'enabled',
      }),
    onSuccess: refreshAfterVersionChange,
    onError: (error) => setApiError(errorMessage(error)),
  })

  const publishMutation = useMutation({
    mutationFn: (versionId: number) => agentApi.publishVersion(agentId!, versionId),
    onSuccess: refreshAfterVersionChange,
    onError: (error) => setApiError(errorMessage(error)),
  })

  const rollbackMutation = useMutation({
    mutationFn: (versionId: number) => agentApi.rollbackVersion(agentId!, versionId),
    onSuccess: refreshAfterVersionChange,
    onError: (error) => setApiError(errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => agentApi.remove(agentId!),
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

  const current = agent.current_version_detail
  const isEnabled = agent.status === 'enabled'
  const deleteDisabled = confirmName !== agent.name || deleteMutation.isPending

  const handlePublish = (versionId: number) => {
    setApiError('')
    publishMutation.mutate(versionId)
  }

  const handleRollback = (versionId: number, versionNo: number) => {
    setApiError('')
    if (window.confirm(`确定回滚到 v${versionNo}？当前版本将被替换。`)) {
      rollbackMutation.mutate(versionId)
    }
  }

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
          {agent.avatar_url ? (
            <img
              src={agent.avatar_url}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-base font-medium text-indigo-700">
              {agent.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
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
            <p className="mt-0.5 text-xs text-neutral-400">
              {agent.current_version != null ? `当前版本 v${agent.current_version}` : '暂无版本'}
            </p>
          </div>
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
          <h3 className="text-base font-semibold text-neutral-900">基础信息</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-neutral-400">描述</dt>
              <dd className="mt-1 text-neutral-900">{agent.description || '暂无描述'}</dd>
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
          </dl>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">
            当前版本 {current ? `v${current.version}` : ''}
          </h3>
          {current ? (
            <>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-neutral-400">模型</dt>
                  <dd className="mt-1 font-mono text-neutral-900">
                    {current.model_provider} / {current.model_name}
                  </dd>
                </div>
                <div className="flex gap-8">
                  <div>
                    <dt className="text-neutral-400">Temperature</dt>
                    <dd className="mt-1 font-mono text-neutral-900">
                      {current.temperature != null ? current.temperature : '运行时默认'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-400">Max Tokens</dt>
                    <dd className="mt-1 font-mono text-neutral-900">
                      {current.max_tokens != null ? current.max_tokens : '运行时默认'}
                    </dd>
                  </div>
                </div>
              </dl>
              <div className="mt-4 border-t border-neutral-100 pt-4">
                <dt className="text-neutral-400">系统提示词</dt>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 font-mono text-sm leading-relaxed text-neutral-800">
                  {current.system_prompt || '（未设置）'}
                </pre>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">暂无版本</p>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">版本历史</h3>
          {canManage ? (
            <button
              type="button"
              onClick={() => navigate(agentVersionNewPath(orgId, agentId))}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              新建版本
            </button>
          ) : null}
        </div>
        {versions && versions.length > 0 ? (
          <ul className="mt-4 divide-y divide-neutral-50">
            {versions.map((v) => {
              // 当前版本标记以后端 is_current 为准（由 current_version_id 计算，兜底比对当前版本 id）
              const isCurrent = v.is_current || (current != null && v.id === current.id)
              // 未发布的更高序号版本 → 发布；历史版本 → 回滚（需求 3.4 语义映射）
              const isOlderThanCurrent =
                agent.current_version != null && v.version < agent.current_version
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-14 shrink-0 font-mono text-sm text-neutral-900">
                    v{v.version}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">
                    {v.model_provider} / {v.model_name}
                  </span>
                  <span className="hidden text-xs text-neutral-400 sm:block">
                    {v.created_by_username} · {new Date(v.created_at).toLocaleString('zh-CN')}
                  </span>
                  {isCurrent ? (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700">
                      当前
                    </span>
                  ) : canManage ? (
                    isOlderThanCurrent ? (
                      <button
                        type="button"
                        disabled={rollbackMutation.isPending}
                        onClick={() => handleRollback(v.id, v.version)}
                        className="shrink-0 rounded-lg border border-amber-300 px-3 py-1 text-xs text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        回滚
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={publishMutation.isPending}
                        onClick={() => handlePublish(v.id)}
                        className="shrink-0 rounded-lg border border-emerald-300 px-3 py-1 text-xs text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        发布
                      </button>
                    )
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">暂无版本记录</p>
        )}
      </section>

      {canManage ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-red-600">危险区</h3>
          <div className="mt-4 border-t border-neutral-100 pt-5">
            <p className="text-sm font-medium text-neutral-900">删除智能体</p>
            <p className="mt-1 text-xs text-neutral-500">
              请输入智能体名称确认，删除后所有版本一并清除且不可恢复
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