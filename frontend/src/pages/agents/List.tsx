// pages/agents/List.tsx
// 智能体列表：搜索 + 状态页签 + 卡片网格（名称/当前版本/状态/创建时间）+ 新建入口；管理操作按角色矩阵渲染
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { agentApi, conversationApi } from '@/api'
import Icon from '@/components/Icon'
import { AGENT_STATUS_LABELS, canChatAgent, canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import {
  agentDetailPath,
  agentEditPath,
  agentNewPath,
  chatConversationPath,
} from '@/constants/routes'
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
  const filter = {
    name: name || undefined,
    status: status === 'all' ? undefined : status,
  }
  const { data: agents, isPending } = useAgents(orgId, filter)
  const [apiError, setApiError] = useState('')

  const canManage = canManageAgent(org?.my_role)
  const canChat = canChatAgent(org?.my_role)

  /** 启停后刷新当前过滤条件下的列表缓存 */
  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: agentsQueryKey(orgId ?? 0, filter) })

  const toggleStatus = useMutation({
    mutationFn: ({ agentId, status: next }: { agentId: number; status: AgentStatus }) =>
      agentApi.setStatus(agentId, { status: next }),
    onSuccess: refreshList,
    onError: (error) => setApiError(errorMessage(error)),
  })

  /** 从卡片发起对话：创建会话后跳转对话页 */
  const startChat = useMutation({
    mutationFn: async (agentId: number) =>
      (await conversationApi.create({ agent_id: agentId })).data,
    onSuccess: (created) => navigate(chatConversationPath(orgId!, created.id)),
    onError: (error) => setApiError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="muted">组织参数无效</p>
  }

  const handleToggle = (agentId: number, current: AgentStatus) => {
    setApiError('')
    toggleStatus.mutate({ agentId, status: current === 'enabled' ? 'disabled' : 'enabled' })
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">智能体管理</h1>
          <p className="page-sub">
            {org ? `${org.name} · 智能体配置、版本与生命周期管理` : '加载中…'}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => navigate(agentNewPath(orgId))}
            className="btn primary"
          >
            <Icon name="plus" className="ic" />
            新建智能体
          </button>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="input w-72">
          <Icon name="search" className="ic" />
          <input
            type="search"
            placeholder="按名称搜索智能体…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="tabs">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={status === f.value ? 'active' : ''}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="muted text-[12.5px]">
          {agents ? `共 ${agents.length} 个智能体` : ''}
        </p>
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : agents && agents.length > 0 ? (
        <ul className="grid g2 mt-6 xl:grid-cols-3">
          {agents.map((agent) => {
            const isEnabled = agent.status === 'enabled'
            const toggling =
              toggleStatus.isPending && toggleStatus.variables?.agentId === agent.id
            return (
              <li key={agent.id} className="card card-pad flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  {agent.avatar_url ? (
                    <img
                      src={agent.avatar_url}
                      alt=""
                      className="avatar md shrink-0 object-cover"
                    />
                  ) : (
                    <span className={`avatar md ${avatarTone(agent.name)}`}>
                      {agent.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15px] font-bold">{agent.name}</h3>
                      <span className={`badge ${isEnabled ? 'ok' : 'off'}`}>
                        {AGENT_STATUS_LABELS[agent.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] muted">
                      {agent.current_version != null
                        ? `当前版本 v${agent.current_version}`
                        : '暂无版本'}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 min-h-9 text-[13px] muted">
                  {agent.description || '暂无描述'}
                </p>
                <p className="text-[12px] muted">创建于 {formatDate(agent.created_at)}</p>
                <div className="row-actions mt-1">
                  {canChat && isEnabled ? (
                    <button
                      type="button"
                      disabled={startChat.isPending && startChat.variables === agent.id}
                      onClick={() => {
                        setApiError('')
                        startChat.mutate(agent.id)
                      }}
                      className="btn primary xs"
                    >
                      {startChat.isPending && startChat.variables === agent.id ? (
                        '创建中…'
                      ) : (
                        <>
                          <Icon name="chat" className="ic" />
                          对话
                        </>
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => navigate(agentDetailPath(orgId, agent.id))}
                    className="btn ghost xs"
                  >
                    查看
                  </button>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => navigate(agentEditPath(orgId, agent.id))}
                        className="btn ghost xs"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={toggling}
                        onClick={() => handleToggle(agent.id, agent.status)}
                        className={`btn xs ml-auto ${isEnabled ? 'danger-ghost' : 'ghost'}`}
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
        <div className="empty mt-6">
          <Icon name="bot" className="ic" />
          <p>
            {name || status !== 'all'
              ? '没有匹配的智能体'
              : canManage
                ? '尚未创建智能体，点击右上角「新建智能体」开始配置'
                : '该组织暂无智能体'}
          </p>
          {canManage && !name && status === 'all' ? (
            <div className="actions">
              <button
                type="button"
                onClick={() => navigate(agentNewPath(orgId))}
                className="btn primary sm"
              >
                <Icon name="plus" className="ic" />
                新建智能体
              </button>
            </div>
          ) : null}
        </div>
      )}
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}
