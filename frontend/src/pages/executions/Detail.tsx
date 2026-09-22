// pages/executions/Detail.tsx
// 执行详情：汇总卡（时长/Token/状态）+ LLM 用量表 + 执行链路时间轴（llm 轮次 / RAG 检索 / 工具调用，execution.md）
import { useNavigate, useParams } from 'react-router-dom'

import { chatConversationPath, executionsPath } from '@/constants/routes'
import { useExecution } from '@/hooks/useExecutions'
import { useOrg } from '@/hooks/useOrg'
import type { ExecutionStep } from '@/types'

import { formatDuration } from './List'

const STEP_TYPE_META: Record<string, { label: string; className: string }> = {
  llm: { label: 'LLM', className: 'bg-indigo-50 text-indigo-700' },
  rag: { label: 'RAG', className: 'bg-emerald-50 text-emerald-700' },
  tool: { label: 'Tool', className: 'bg-amber-50 text-amber-700' },
}

const STEP_LABELS: Record<string, string> = {
  rag_retrieval: '知识库检索',
}

function stepTitle(step: ExecutionStep): string {
  if (step.step_type === 'llm') {
    const round = step.input_json?.round
    return `LLM 调用（第 ${round} 轮）`
  }
  if (step.step_name in STEP_LABELS) return STEP_LABELS[step.step_name]
  return step.step_name
}

function formatTokens(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 步骤卡片内容渲染：按类型取 input/output 关键字段 */
function StepBody({ step }: { step: ExecutionStep }) {
  if (step.step_type === 'llm') {
    const input = step.input_json ?? {}
    const output = step.output_json ?? {}
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-neutral-600 sm:grid-cols-4">
        <div>
          <dt className="text-neutral-400">模型</dt>
          <dd className="mt-0.5">{String(input.model ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">上下文消息数</dt>
          <dd className="mt-0.5">{String(input.message_count ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">输出字符</dt>
          <dd className="mt-0.5">{String(output.output_chars ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">工具调用</dt>
          <dd className="mt-0.5">{output.has_tool_calls ? '是' : '否'}</dd>
        </div>
      </dl>
    )
  }
  if (step.step_type === 'rag') {
    const input = step.input_json ?? {}
    const output = step.output_json ?? {}
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-neutral-600 sm:grid-cols-4">
        <div className="col-span-2">
          <dt className="text-neutral-400">查询</dt>
          <dd className="mt-0.5 text-neutral-900">{String(input.query ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">知识库</dt>
          <dd className="mt-0.5">
            {(input.knowledge_base_ids as number[] | undefined)?.join(', ') ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">命中片段</dt>
          <dd className="mt-0.5">{String(output.hit_count ?? '—')}</dd>
        </div>
      </dl>
    )
  }
  const input = step.input_json ?? {}
  const output = step.output_json ?? {}
  return (
    <div className="space-y-2 text-xs text-neutral-600">
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 font-mono leading-relaxed">
        {JSON.stringify(input.arguments ?? {}, null, 2)}
      </pre>
      <p className="text-neutral-500">
        返回：<span className="text-neutral-900">{String(output.output ?? '—')}</span>
      </p>
    </div>
  )
}

export default function ExecutionDetail() {
  const { orgId: orgIdParam, executionId } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const navigate = useNavigate()

  const { data: org } = useOrg(orgId)
  const { data: execution, isPending } = useExecution(orgId, executionId ?? null)

  if (orgId == null || executionId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">参数无效</p>
  }
  if (isPending) {
    return <p className="text-sm text-neutral-500">加载中…</p>
  }
  if (!execution) {
    return <p className="text-sm text-neutral-500">执行记录不存在</p>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(executionsPath(orgId))}
        className="text-sm text-neutral-500 transition hover:text-neutral-700"
      >
        ← 返回执行列表
      </button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-neutral-900">
            {execution.agent_name ?? `Agent #${execution.agent_id}`}
          </h2>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-medium ${
              execution.status === 'success'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-600'
            }`}
          >
            {execution.status === 'success' ? '成功' : '失败'}
          </span>
          <button
            type="button"
            onClick={() => navigate(chatConversationPath(orgId, execution.conversation_id))}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition hover:bg-neutral-100"
          >
            查看对话
          </button>
        </div>
        <p className="text-xs text-neutral-400">
          {org ? `${org.name} · ` : ''}
          {new Date(execution.started_at).toLocaleString('zh-CN')} 起 · 执行 ID{' '}
          {execution.execution_id.slice(0, 8)}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-400">总耗时</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {formatDuration(execution.duration_ms)}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-400">Token 消耗</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {formatTokens(execution.total_tokens)}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-400">步骤数</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {execution.step_count}
            {execution.error_steps > 0 ? (
              <span className="ml-2 text-sm font-normal text-red-500">
                {execution.error_steps} 失败
              </span>
            ) : null}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-neutral-400">LLM 累计耗时</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {formatDuration(execution.llm_latency_ms)}
          </p>
        </div>
      </div>

      {execution.usages.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">LLM 用量</h3>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-neutral-100 text-xs text-neutral-500">
              <tr>
                <th className="py-2 pr-4 font-medium">轮次</th>
                <th className="py-2 pr-4 font-medium">模型</th>
                <th className="py-2 pr-4 font-medium">输入</th>
                <th className="py-2 pr-4 font-medium">输出</th>
                <th className="py-2 pr-4 font-medium">合计</th>
                <th className="py-2 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {execution.usages.map((usage) => (
                <tr key={usage.id} className="border-b border-neutral-50 text-neutral-700 last:border-0">
                  <td className="py-2 pr-4">#{usage.round}</td>
                  <td className="py-2 pr-4">{usage.model}</td>
                  <td className="py-2 pr-4">{formatTokens(usage.input_tokens)}</td>
                  <td className="py-2 pr-4">{formatTokens(usage.output_tokens)}</td>
                  <td className="py-2 pr-4 font-medium text-neutral-900">
                    {formatTokens(usage.total_tokens)}
                  </td>
                  <td className="py-2">{formatDuration(usage.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-neutral-900">执行链路</h3>
        <ol className="mt-5 space-y-0">
          {execution.steps.map((step, index) => {
            const meta = STEP_TYPE_META[step.step_type] ?? STEP_TYPE_META.llm
            return (
              <li key={step.id} className="relative flex gap-4 pb-6 last:pb-0">
                {index < execution.steps.length - 1 ? (
                  <span className="absolute left-[11px] top-6 h-full w-px bg-neutral-200" />
                ) : null}
                <span
                  className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${meta.className}`}
                >
                  {step.step_type === 'llm' ? 'L' : step.step_type === 'rag' ? 'R' : 'T'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-medium text-neutral-900">
                      {stepTitle(step)}
                    </h4>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    {step.status === 'error' ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                        失败
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-neutral-400">
                      {formatDuration(step.duration_ms)}
                    </span>
                  </div>
                  <div className="mt-2 rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                    <StepBody step={step} />
                    {step.status === 'error' && step.output_json?.error_code ? (
                      <p className="mt-2 text-xs text-red-600">
                        错误码：{String(step.output_json.error_code)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}