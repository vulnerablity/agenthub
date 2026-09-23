// pages/executions/List.tsx
// 执行监控列表：Agent/状态筛选 + 分页表格（execution.md：每行为一次 Agent 执行，点击进入链路详情）
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import Icon from '@/components/Icon'
import { executionDetailPath } from '@/constants/routes'
import { useAgents } from '@/hooks/useAgents'
import { useExecutions } from '@/hooks/useExecutions'
import { useOrg } from '@/hooks/useOrg'
import type { ExecutionStatus } from '@/types'
import { formatDuration } from '@/pages/executions/utils'

const PAGE_SIZE = 20

const STATUS_BADGES: Record<ExecutionStatus, { label: string; badge: string }> = {
  success: { label: '成功', badge: 'ok' },
  error: { label: '失败', badge: 'err' },
}

function formatTokens(n: number): string {
  return n.toLocaleString('zh-CN')
}

export default function ExecutionList() {
  const { orgId: orgIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const navigate = useNavigate()

  const [agentFilter, setAgentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | ExecutionStatus>('')
  const [page, setPage] = useState(0)

  const { data: org } = useOrg(orgId)
  const { data: agents } = useAgents(orgId, {})
  const params = {
    agent_id: agentFilter ? Number(agentFilter) : undefined,
    status: statusFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }
  const { data, isPending, isFetching } = useExecutions(orgId, params)

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="muted">组织参数无效</p>
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleFilterChange = () => setPage(0)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">执行监控</h1>
          <p className="page-sub">
            {org ? `${org.name} · Agent 执行链路（LLM / RAG / Tool / Token）` : '加载中…'}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value)
            handleFilterChange()
          }}
          className="select"
        >
          <option value="">全部 Agent</option>
          {(agents ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as '' | ExecutionStatus)
            handleFilterChange()
          }}
          className="select"
        >
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">失败</option>
        </select>
        {isFetching ? (
          <span className="text-[12px] muted">
            <Icon name="loader" width={12} height={12} style={{ verticalAlign: '-1px' }} /> 刷新中…
          </span>
        ) : null}
      </div>

      {isPending ? (
        <p className="mt-6 muted">加载中…</p>
      ) : items.length > 0 ? (
        <div className="table-wrap mt-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>开始时间</th>
                <th>Agent</th>
                <th>步骤</th>
                <th>Token</th>
                <th>LLM 耗时</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const badge = STATUS_BADGES[item.status]
                return (
                  <tr
                    key={item.execution_id}
                    onClick={() => navigate(executionDetailPath(orgId, item.execution_id))}
                    className="cursor-pointer transition hover:bg-[var(--accent-soft)]"
                  >
                    <td className="muted">
                      {new Date(item.started_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="strong">{item.agent_name ?? `Agent #${item.agent_id}`}</td>
                    <td>
                      <span className="mono">{item.step_count}</span>
                      {item.error_steps > 0 ? (
                        <span className="ml-1 text-[12px] text-red-500">
                          ({item.error_steps} 失败)
                        </span>
                      ) : null}
                    </td>
                    <td className="mono muted">{formatTokens(item.total_tokens)}</td>
                    <td className="mono muted">{formatDuration(item.llm_latency_ms)}</td>
                    <td className="mono muted">{formatDuration(item.duration_ms)}</td>
                    <td>
                      <span className={`badge ${badge.badge}`}>{badge.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty mt-6">
          <Icon name="activity" className="ic" />
          <p>暂无执行记录，去「AI 对话」发起一次对话后将自动记录执行链路</p>
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="pager mt-4">
          <span>
            共 {formatTokens(total)} 次执行 · 第 {page + 1} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="btn ghost sm"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="btn ghost sm"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
