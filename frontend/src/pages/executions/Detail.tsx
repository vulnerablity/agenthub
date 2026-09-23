// pages/executions/Detail.tsx
// 执行详情：汇总卡（时长/Token/状态）+ LLM 用量表 + 执行链路时间轴（llm 轮次 / RAG 检索 / 工具调用，execution.md）
import { useNavigate, useParams } from 'react-router-dom'

import Icon from '@/components/Icon'
import { chatConversationPath, executionsPath } from '@/constants/routes'
import { useExecution } from '@/hooks/useExecutions'
import { useOrg } from '@/hooks/useOrg'
import type { ExecutionStep } from '@/types'

import { formatDuration } from '@/pages/executions/utils'

const STEP_TYPE_META: Record<string, { label: string; badge: string; dot: string }> = {
  llm: { label: 'LLM', badge: 'accent', dot: 'dot-accent' },
  rag: { label: 'RAG', badge: 'ok', dot: 'dot-ok' },
  tool: { label: 'Tool', badge: 'warn', dot: 'dot-warn' },
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
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] text-[var(--ink-2)] sm:grid-cols-4">
        <div>
          <dt className="muted">模型</dt>
          <dd className="mt-0.5">{String(input.model ?? '—')}</dd>
        </div>
        <div>
          <dt className="muted">上下文消息数</dt>
          <dd className="mt-0.5">{String(input.message_count ?? '—')}</dd>
        </div>
        <div>
          <dt className="muted">输出字符</dt>
          <dd className="mt-0.5">{String(output.output_chars ?? '—')}</dd>
        </div>
        <div>
          <dt className="muted">工具调用</dt>
          <dd className="mt-0.5">{output.has_tool_calls ? '是' : '否'}</dd>
        </div>
      </dl>
    )
  }
  if (step.step_type === 'rag') {
    const input = step.input_json ?? {}
    const output = step.output_json ?? {}
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] text-[var(--ink-2)] sm:grid-cols-4">
        <div className="col-span-2">
          <dt className="muted">查询</dt>
          <dd className="mt-0.5 text-[var(--ink-1)]">{String(input.query ?? '—')}</dd>
        </div>
        <div>
          <dt className="muted">知识库</dt>
          <dd className="mt-0.5">
            {(input.knowledge_base_ids as number[] | undefined)?.join(', ') ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="muted">命中片段</dt>
          <dd className="mt-0.5">{String(output.hit_count ?? '—')}</dd>
        </div>
      </dl>
    )
  }
  const input = step.input_json ?? {}
  const output = step.output_json ?? {}
  return (
    <div className="space-y-2 text-[12px] text-[var(--ink-2)]">
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-[10px] bg-[#f8f9fd] p-3 mono leading-relaxed text-[#141731]">
        {JSON.stringify(input.arguments ?? {}, null, 2)}
      </pre>
      <p className="muted">
        返回：<span className="text-[var(--ink-1)]">{String(output.output ?? '—')}</span>
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
    return <p className="muted">参数无效</p>
  }
  if (isPending) {
    return <p className="muted">加载中…</p>
  }
  if (!execution) {
    return <p className="muted">执行记录不存在</p>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(executionsPath(orgId))}
        className="btn ghost xs"
      >
        <Icon name="back" className="ic" />
        返回执行列表
      </button>

      <div className="card card-pad mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`avatar md ${execution.status === 'success' ? 'av-2' : 'av-4'}`}>
            <Icon name={execution.status === 'success' ? 'check' : 'alert'} width={16} height={16} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="page-title">{execution.agent_name ?? `Agent #${execution.agent_id}`}</h2>
              <span className={`badge ${execution.status === 'success' ? 'ok' : 'err'}`}>
                {execution.status === 'success' ? '成功' : '失败'}
              </span>
              <button
                type="button"
                onClick={() => navigate(chatConversationPath(orgId, execution.conversation_id))}
                className="btn ghost xs"
              >
                <Icon name="chat" className="ic" />
                查看对话
              </button>
            </div>
            <p className="mt-1 text-[12px] muted">
              {org ? `${org.name} · ` : ''}
              {new Date(execution.started_at).toLocaleString('zh-CN')} 起 · 执行 ID{' '}
              <span className="mono">{execution.execution_id.slice(0, 8)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid g4 mt-5">
        <div className="card stat">
          <p className="stat-label">总耗时</p>
          <p className="stat-value mono">{formatDuration(execution.duration_ms)}</p>
        </div>
        <div className="card stat">
          <p className="stat-label">Token 消耗</p>
          <p className="stat-value mono">{formatTokens(execution.total_tokens)}</p>
        </div>
        <div className="card stat">
          <p className="stat-label">步骤数</p>
          <p className="stat-value mono">
            {execution.step_count}
            {execution.error_steps > 0 ? (
              <span className="ml-2 text-[13px] font-normal text-red-500">
                {execution.error_steps} 失败
              </span>
            ) : null}
          </p>
        </div>
        <div className="card stat">
          <p className="stat-label">LLM 累计耗时</p>
          <p className="stat-value mono">{formatDuration(execution.llm_latency_ms)}</p>
        </div>
      </div>

      {execution.usages.length > 0 ? (
        <section className="card card-pad mt-5">
          <h3 className="card-title">
            <Icon name="cpu" className="ic" />
            LLM 用量
          </h3>
          <div className="table-wrap mt-3" style={{ boxShadow: 'none' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>轮次</th>
                  <th>模型</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>合计</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {execution.usages.map((usage) => (
                  <tr key={usage.id}>
                    <td className="mono">#{usage.round}</td>
                    <td className="mono">{usage.model}</td>
                    <td className="mono muted">{formatTokens(usage.input_tokens)}</td>
                    <td className="mono muted">{formatTokens(usage.output_tokens)}</td>
                    <td className="mono strong">{formatTokens(usage.total_tokens)}</td>
                    <td className="mono muted">{formatDuration(usage.latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card card-pad mt-5">
        <h3 className="card-title">
          <Icon name="activity" className="ic" />
          执行链路
        </h3>
        <ol className="chain mt-4">
          {execution.steps.map((step) => {
            const meta = STEP_TYPE_META[step.step_type] ?? STEP_TYPE_META.llm
            const stepErr = step.status === 'error'
            return (
              <li key={step.id} className={`chain-item${stepErr ? ' step-err' : ''}`}>
                <span className={`dot ${meta.dot}${stepErr ? ' dot-err' : ''}`}>
                  {step.step_type === 'llm' ? 'L' : step.step_type === 'rag' ? 'R' : 'T'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[13.5px] font-semibold">{stepTitle(step)}</h4>
                    <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    {stepErr ? <span className="badge err">失败</span> : null}
                    <span className="ml-auto mono muted text-[12px]">
                      {formatDuration(step.duration_ms)}
                    </span>
                  </div>
                  <div className="mt-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <StepBody step={step} />
                    {stepErr && step.output_json?.error_code ? (
                      <p className="mt-2 text-[12px] text-red-600">
                        错误码：<span className="mono">{String(step.output_json.error_code)}</span>
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
