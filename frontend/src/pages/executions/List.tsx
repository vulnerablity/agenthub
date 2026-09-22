// pages/executions/List.tsx
// 执行监控列表：Agent/状态筛选 + 分页表格（execution.md：每行为一次 Agent 执行，点击进入链路详情）
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { executionDetailPath } from '@/constants/routes'
import { useAgents } from '@/hooks/useAgents'
import { useExecutions } from '@/hooks/useExecutions'
import { useOrg } from '@/hooks/useOrg'
import type { ExecutionStatus } from '@/types'

const PAGE_SIZE = 20

const STATUS_BADGES: Record<ExecutionStatus, { label: string; className: string }> = {
  success: { label: '成功', className: 'bg-emerald-50 text-emerald-700' },
  error: { label: '失败', className: 'bg-red-50 text-red-600' },
}

/** 毫秒耗时展示：<1s 显示 ms，否则秒保留两位 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
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
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleFilterChange = () => setPage(0)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">执行监控</h2>
          <p className="mt-1 text-sm text-neutral-500">
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
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 outline-none transition focus:border-indigo-500"
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
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 outline-none transition focus:border-indigo-500"
        >
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">失败</option>
        </select>
        {isFetching ? <span className="text-xs text-neutral-400">刷新中…</span> : null}
      </div>

      {isPending ? (
        <p className="mt-6 text-sm text-neutral-500">加载中…</p>
      ) : items.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">开始时间</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">步骤</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">LLM 耗时</th>
                <th className="px-4 py-3 font-medium">总耗时</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const badge = STATUS_BADGES[item.status]
                return (
                  <tr
                    key={item.execution_id}
                    onClick={() => navigate(executionDetailPath(orgId, item.execution_id))}
                    className="cursor-pointer border-b border-neutral-50 transition last:border-0 hover:bg-indigo-50/40"
                  >
                    <td className="px-4 py-3 text-neutral-700">
                      {new Date(item.started_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-neutral-900">
                      {item.agent_name ?? `Agent #${item.agent_id}`}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {item.step_count}
                      {item.error_steps > 0 ? (
                        <span className="ml-1 text-xs text-red-500">
                          ({item.error_steps} 失败)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {formatTokens(item.total_tokens)}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {formatDuration(item.llm_latency_ms)}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {formatDuration(item.duration_ms)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-500">
            暂无执行记录，去「AI 对话」发起一次对话后将自动记录执行链路
          </p>
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
          <span>
            共 {formatTokens(total)} 次执行 · 第 {page + 1} / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}