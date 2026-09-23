// pages/agents/Detail.tsx
// 智能体详情：基础信息 + 当前版本配置 + 版本历史（发布/回滚）+ 工具绑定 + 删除危险区（需求 3.3/3.4/3.7）
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { agentApi, conversationApi } from '@/api'
import Icon from '@/components/Icon'
import { AGENT_STATUS_LABELS, canChatAgent, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import {
  agentEditPath,
  agentVersionNewPath,
  agentsPath,
  chatConversationPath,
  toolsPath,
} from '@/constants/routes'
import { useAgent, useAgentVersions } from '@/hooks/useAgent'
import {
  useBindAgentTool,
  useAgentTools,
  useUnbindAgentTool,
  useUpdateAgentTool,
} from '@/hooks/useAgentTools'
import { useOrg } from '@/hooks/useOrg'
import { useTools } from '@/hooks/useTools'

export default function AgentDetail() {
  const { orgId: orgIdParam, agentId: agentIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const agentId = agentIdParam ? Number(agentIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: agent, isPending } = useAgent(orgId, agentId)
  const { data: versions } = useAgentVersions(orgId, agentId)
  // 工具绑定（tool-calling.md 3.4）：已绑定列表 + 组织内可选工具
  const { data: boundTools } = useAgentTools(agentId)
  const { data: allTools } = useTools(orgId)
  const [apiError, setApiError] = useState('')
  const [confirmName, setConfirmName] = useState('')
  // 绑定弹层状态：待绑定工具 id
  const [bindToolId, setBindToolId] = useState<number | null>(null)

  const canManage = canManageAgent(org?.my_role)
  const canChat = canChatAgent(org?.my_role)

  const bindMutation = useBindAgentTool(agentId ?? 0)
  const updateBindingMutation = useUpdateAgentTool(agentId ?? 0)
  const unbindMutation = useUnbindAgentTool(agentId ?? 0)

  const handleBind = () => {
    if (agentId == null || bindToolId == null) return
    setApiError('')
    bindMutation.mutate(
      { tool_id: bindToolId },
      {
        onSuccess: () => setBindToolId(null),
        onError: (error) => setApiError(errorMessage(error)),
      },
    )
  }

  /** 从详情页发起对话：创建会话后跳转对话页 */
  const startChat = useMutation({
    mutationFn: async () => (await conversationApi.create({ agent_id: agentId! })).data,
    onSuccess: (created) => navigate(chatConversationPath(orgId!, created.id)),
    onError: (error) => setApiError(errorMessage(error)),
  })

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
    return <p className="muted">参数无效</p>
  }

  if (isPending) {
    return <p className="muted">加载中…</p>
  }

  if (!agent) {
    return <p className="muted">智能体不存在</p>
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
    <div>
      <button type="button" onClick={() => navigate(agentsPath(orgId))} className="btn ghost xs">
        <Icon name="back" className="ic" />
        返回智能体列表
      </button>

      {/* 头部信息 */}
      <div className="card card-pad mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {agent.avatar_url ? (
            <img src={agent.avatar_url} alt="" className="avatar lg shrink-0 object-cover" />
          ) : (
            <span className={`avatar lg ${avatarTone(agent.name)}`}>
              {agent.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h2 className="page-title">{agent.name}</h2>
              <span className={`badge ${isEnabled ? 'ok' : 'off'}`}>
                {AGENT_STATUS_LABELS[agent.status]}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] muted">
              {agent.current_version != null ? `当前版本 v${agent.current_version}` : '暂无版本'}
              {current ? (
                <>
                  {' · '}
                  <span className="mono">{current.model_provider} / {current.model_name}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="row-actions">
          {canChat && isEnabled ? (
            <button
              type="button"
              disabled={startChat.isPending}
              onClick={() => {
                setApiError('')
                startChat.mutate()
              }}
              className="btn primary sm"
            >
              {startChat.isPending ? (
                '创建中…'
              ) : (
                <>
                  <Icon name="chat" className="ic" />
                  开始对话
                </>
              )}
            </button>
          ) : null}
          {canManage ? (
            <>
              <button
                type="button"
                disabled={toggleStatus.isPending}
                onClick={() => {
                  setApiError('')
                  toggleStatus.mutate()
                }}
                className={`btn sm ${isEnabled ? 'danger-ghost' : 'ghost'}`}
              >
                {toggleStatus.isPending ? '…' : isEnabled ? '停用' : '启用'}
              </button>
              <button
                type="button"
                onClick={() => navigate(agentEditPath(orgId, agent.id))}
                className="btn ghost sm"
              >
                <Icon name="edit" className="ic" />
                编辑
              </button>
            </>
          ) : null}
        </div>
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <div className="grid g2 mt-5">
        {/* 基础信息 */}
        <section className="card card-pad">
          <h3 className="card-title">
            <Icon name="bot" className="ic" />
            基础信息
          </h3>
          <dl className="kv mt-3">
            <div className="row">
              <dt>描述</dt>
              <dd>{agent.description || '暂无描述'}</dd>
            </div>
            <div className="row">
              <dt>创建者</dt>
              <dd>{agent.created_by_username}</dd>
            </div>
            <div className="row">
              <dt>创建时间</dt>
              <dd>{new Date(agent.created_at).toLocaleString('zh-CN')}</dd>
            </div>
          </dl>
        </section>

        {/* 当前版本 */}
        <section className="card card-pad">
          <h3 className="card-title">
            <Icon name="layers" className="ic" />
            当前版本 {current ? `v${current.version}` : ''}
          </h3>
          {current ? (
            <>
              <dl className="kv mt-3">
                <div className="row">
                  <dt>模型</dt>
                  <dd>
                    <span className="mono">{current.model_provider} / {current.model_name}</span>
                  </dd>
                </div>
                <div className="row">
                  <dt>Temperature</dt>
                  <dd>
                    <span className="mono">
                      {current.temperature != null ? current.temperature : '运行时默认'}
                    </span>
                  </dd>
                </div>
                <div className="row">
                  <dt>Max Tokens</dt>
                  <dd>
                    <span className="mono">
                      {current.max_tokens != null ? current.max_tokens : '运行时默认'}
                    </span>
                  </dd>
                </div>
              </dl>
              <div className="mt-2">
                <dt className="muted text-[12px] font-medium">系统提示词</dt>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-[10px] bg-[#f8f9fd] p-3.5 mono leading-relaxed text-[#141731]">
                  {current.system_prompt || '（未设置）'}
                </pre>
              </div>
            </>
          ) : (
            <p className="mt-3 muted">暂无版本</p>
          )}
        </section>
      </div>

      {/* 版本历史 */}
      <section className="card card-pad mt-5">
        <div className="flex-between">
          <h3 className="card-title">
            <Icon name="layers" className="ic" />
            版本历史
          </h3>
          {canManage ? (
            <button
              type="button"
              onClick={() => navigate(agentVersionNewPath(orgId, agentId))}
              className="btn primary sm"
            >
              <Icon name="plus" className="ic" />
              新建版本
            </button>
          ) : null}
        </div>
        {versions && versions.length > 0 ? (
          <div className="vlist mt-4">
            {versions.map((v) => {
              // 当前版本标记以后端 is_current 为准（由 current_version_id 计算，兜底比对当前版本 id）
              const isCurrent = v.is_current || (current != null && v.id === current.id)
              // 未发布的更高序号版本 → 发布；历史版本 → 回滚（需求 3.4 语义映射）
              const isOlderThanCurrent =
                agent.current_version != null && v.version < agent.current_version
              return (
                <div key={v.id} className={`vitem${isCurrent ? ' current' : ''}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="mono font-bold">{v.version} 版</span>
                    {isCurrent ? <span className="badge accent">当前</span> : null}
                    <span className="mono muted">{v.model_provider} / {v.model_name}</span>
                    <span className="text-[12px] muted">
                      {v.created_by_username} · {new Date(v.created_at).toLocaleString('zh-CN')}
                    </span>
                    <span className="ml-auto">
                      {!isCurrent && canManage ? (
                        isOlderThanCurrent ? (
                          <button
                            type="button"
                            disabled={rollbackMutation.isPending}
                            onClick={() => handleRollback(v.id, v.version)}
                            className="btn xs danger-ghost"
                          >
                            回滚
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={publishMutation.isPending}
                            onClick={() => handlePublish(v.id)}
                            className="btn xs ghost"
                          >
                            发布
                          </button>
                        )
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[12px] muted">
                    {v.system_prompt || '（未设置系统提示词）'}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-3 muted">暂无版本记录</p>
        )}
      </section>

      {/* 工具绑定 */}
      <section className="card card-pad mt-5">
        <div className="flex-between">
          <div>
            <h3 className="card-title">
              <Icon name="wrench" className="ic" />
              工具
            </h3>
            <p className="card-sub">对话中智能体将按需调用已启用工具（Tool Calling）</p>
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => navigate(toolsPath(orgId))}
              className="btn ghost xs"
            >
              <Icon name="arrow" className="ic" />
              管理工具库
            </button>
          ) : null}
        </div>

        {boundTools && boundTools.length > 0 ? (
          <ul className="mt-3">
            {boundTools.map((binding) => (
              <li
                key={binding.id}
                className="flex flex-wrap items-center gap-3 border-b border-dashed border-[var(--line)] py-3 last:border-b-0"
              >
                <span className="strong">{binding.tool_name}</span>
                <span className="tag">
                  {binding.tool_type === 'calculator' ? '计算器' : 'HTTP'}
                </span>
                <span className="min-w-0 flex-1 truncate muted text-[12.5px]">
                  {binding.tool_description || '暂无描述'}
                </span>
                {canManage ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]">
                    <input
                      type="checkbox"
                      checked={binding.enabled}
                      disabled={updateBindingMutation.isPending}
                      onChange={(e) => {
                        setApiError('')
                        updateBindingMutation.mutate(
                          { toolId: binding.tool_id, data: { enabled: e.target.checked } },
                          { onError: (error) => setApiError(errorMessage(error)) },
                        )
                      }}
                      className="h-4 w-4 rounded accent-[#5b5bd6]"
                    />
                    启用
                  </label>
                ) : (
                  <span className="badge off">{binding.enabled ? '已启用' : '已停用'}</span>
                )}
                {canManage ? (
                  <button
                    type="button"
                    disabled={unbindMutation.isPending}
                    onClick={() => {
                      setApiError('')
                      if (window.confirm(`确定解绑工具「${binding.tool_name}」？`)) {
                        unbindMutation.mutate(binding.tool_id, {
                          onError: (error) => setApiError(errorMessage(error)),
                        })
                      }
                    }}
                    className="btn xs danger-ghost"
                  >
                    解绑
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 muted">尚未绑定工具</p>
        )}

        {canManage ? (
          <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-4">
            <select
              value={bindToolId ?? ''}
              onChange={(e) => setBindToolId(e.target.value ? Number(e.target.value) : null)}
              className="select flex-1"
            >
              <option value="">选择要绑定的工具…</option>
              {(allTools ?? [])
                .filter(
                  (tool) => !(boundTools ?? []).some((binding) => binding.tool_id === tool.id),
                )
                .map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name}（{tool.type === 'calculator' ? '计算器' : 'HTTP'}）
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={bindToolId == null || bindMutation.isPending}
              onClick={handleBind}
              className="btn primary sm"
            >
              {bindMutation.isPending ? '绑定中…' : '绑定'}
            </button>
          </div>
        ) : null}
      </section>

      {/* 危险区 */}
      {canManage ? (
        <section
          className="card card-pad mt-5"
          style={{ borderColor: '#f2c6c6', background: '#fffafa' }}
        >
          <h3 className="card-title" style={{ color: 'var(--red)' }}>
            <Icon name="alert" className="ic" />
            危险区
          </h3>
          <div className="mt-3">
            <p className="font-medium">删除智能体</p>
            <p className="mt-1 text-[12.5px] muted">
              请输入智能体名称确认，删除后所有版本一并清除且不可恢复
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="input flex-1" style={{ borderColor: '#f2c6c6' }}>
                <Icon name="edit" className="ic" />
                <input
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={agent.name}
                />
              </div>
              <button
                type="button"
                disabled={deleteDisabled}
                onClick={() => {
                  setApiError('')
                  if (window.confirm(`确定删除智能体「${agent.name}」？此操作不可撤销。`)) {
                    deleteMutation.mutate()
                  }
                }}
                className="btn danger sm"
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

/** 根据名称稳定映射头像渐变 */
function avatarTone(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 997
  }
  return `av-${(hash % 6) + 1}`
}
