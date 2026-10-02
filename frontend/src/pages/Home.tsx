// pages/Home.tsx
// 登录后概览页（工作台）：问候 + 统计卡 + 最近执行 + 当前组织 + 快捷入口；无组织时引导创建
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import Icon from '@/components/Icon'
import { ORG_ROLE_LABELS } from '@/constants/org-roles'
import {
  agentsPath,
  chatPath,
  executionsPath,
  knowledgeBasesPath,
  orgMembersPath,
  orgSettingsPath,
  ROUTE_PATHS,
  executionDetailPath,
} from '@/constants/routes'
import { useAgents } from '@/hooks/useAgents'
import { useExecutions } from '@/hooks/useExecutions'
import { useKnowledgeBases } from '@/hooks/useKnowledgeBases'
import { useMe } from '@/hooks/useMe'
import { useMyOrganizations } from '@/hooks/useMyOrganizations'
import { useOrganizationStore } from '@/stores/organization'
import { useTools } from '@/hooks/useTools'
import type { ExecutionStatus } from '@/types'

const STATUS_BADGE: Record<ExecutionStatus, string> = {
  success: 'badge ok',
  error: 'badge err',
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Home() {
  const navigate = useNavigate()
  const { data: me, isPending } = useMe()
  const currentOrgId = useOrganizationStore((state) => state.currentOrgId)
  const { data: organizations } = useMyOrganizations()
  const currentOrg = organizations?.find((org) => org.id === currentOrgId)
  const orgReady = currentOrgId != null

  const agentsQuery = useAgents(currentOrgId, {}, orgReady)
  const knowledgeQuery = useKnowledgeBases(currentOrgId, orgReady)
  const toolsQuery = useTools(currentOrgId, orgReady)
  const executionsQuery = useExecutions(currentOrgId, { limit: 5 }, orgReady)
  const agents = agentsQuery.data
  const knowledgeBases = knowledgeQuery.data
  const tools = toolsQuery.data
  const executions = executionsQuery.data

  const monthAdded = useMemo(() => {
    if (!agents) return 0
    const now = new Date()
    return agents.filter((a) => {
      const d = new Date(a.created_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
  }, [agents])

  const docTotal = useMemo(
    () => (knowledgeBases ?? []).reduce((sum, kb) => sum + kb.document_count, 0),
    [knowledgeBases],
  )
  const httpToolCount = useMemo(
    () => (tools ?? []).filter((t) => t.type === 'http').length,
    [tools],
  )
  const todayItems = executions?.items ?? []

  return (
    <div>
      {/* 问候 */}
      <div className="page-head">
        <div>
          <h1 className="page-title">你好，{isPending ? '…' : me?.username}</h1>
          <p className="page-sub">
            {currentOrg
              ? `欢迎回到 ${currentOrg.name} · 已累计执行 ${executions?.total ?? 0} 次 Agent 调用`
              : '欢迎回到 AgentHub'}
          </p>
        </div>
        {currentOrg ? (
          <div className="actions">
            <Link to={chatPath(currentOrg.id)} className="btn ghost">
              <Icon name="chat" className="ic" />
              AI 对话
            </Link>
            <Link to={agentsPath(currentOrg.id)} className="btn primary">
              <Icon name="plus" className="ic" />
              新建智能体
            </Link>
          </div>
        ) : null}
      </div>

      {/* 统计卡 */}
      <div className="grid g4 mt-6">
        <div className="card stat">
          <p className="lbl">
            <Icon name="bot" className="ic" />
            智能体
          </p>
          <p className="val">{agents?.length ?? 0}</p>
          <p className="delta">
            本月新增 <b className="up">+{monthAdded}</b>
          </p>
        </div>
        <div className="card stat">
          <p className="lbl">
            <Icon name="file-text" className="ic" />
            知识库文档
          </p>
          <p className="val">{docTotal}</p>
          <p className="delta">
            共 {(knowledgeBases ?? []).length} 个知识库
          </p>
        </div>
        <div className="card stat">
          <p className="lbl">
            <Icon name="wrench" className="ic" />
            工具
          </p>
          <p className="val">{tools?.length ?? 0}</p>
          <p className="delta">含 {httpToolCount} 个 HTTP 工具</p>
        </div>
        <div className="card stat">
          <p className="lbl">
            <Icon name="activity" className="ic" />
            最近执行
          </p>
          <p className="val">{executions?.total ?? 0}</p>
          <p className="delta">全部执行记录</p>
        </div>
      </div>

      {[agentsQuery, knowledgeQuery, toolsQuery, executionsQuery].some((query) => query.isError) ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          部分工作台数据加载失败。{[agentsQuery, knowledgeQuery, toolsQuery, executionsQuery]
            .filter((query) => query.isError)
            .map((query, index) => (
              <button key={index} type="button" className="ml-2 underline" onClick={() => void query.refetch()}>
                重试 {['智能体', '知识库', '工具', '执行记录'][[agentsQuery, knowledgeQuery, toolsQuery, executionsQuery].indexOf(query)]}
              </button>
            ))}
        </div>
      ) : null}

      {currentOrg ? (
        <div className="home-main-grid grid g3 mt-6">
          {/* 最近执行 */}
          <section className="card">
            <div className="flex-between px-5 pt-4">
              <h3 className="card-title">
                <Icon name="activity" className="ic" />
                最近执行
              </h3>
              <Link to={executionsPath(currentOrg.id)} className="text-[12.5px] font-semibold">
                查看全部 <Icon name="arrow" width={12} height={12} style={{ verticalAlign: '-2px' }} />
              </Link>
            </div>
            {todayItems.length === 0 ? (
              <p className="px-5 pb-5 pt-3 text-[13px] text-neutral-400">
                暂无执行记录，去「AI 对话」发起一次对话吧
              </p>
            ) : (
              <div className="table-wrap mt-3 border-0 shadow-none">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>开始时间</th>
                      <th>Agent</th>
                      <th>步骤</th>
                      <th>Token</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayItems.map((exec) => (
                      <tr
                        key={exec.execution_id}
                        className="clickable"
                        onClick={() =>
                          navigate(executionDetailPath(currentOrg.id, exec.execution_id))
                        }
                      >
                        <td className="num muted">{formatTime(exec.started_at)}</td>
                        <td className="strong">{exec.agent_name ?? '—'}</td>
                        <td className="num">{exec.step_count}</td>
                        <td className="num">{exec.total_tokens.toLocaleString()}</td>
                        <td>
                          <span className={STATUS_BADGE[exec.status]}>
                            {exec.status === 'success' ? '成功' : '失败'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 当前组织 */}
          <section className="card card-pad">
            <h3 className="card-title">
              <Icon name="building" className="ic" />
              当前组织
            </h3>
            <div className="mt-4 flex items-start justify-between gap-2">
              <div>
                <p className="text-[16px] font-bold">{currentOrg.name}</p>
                <p className="mt-1 text-[12.5px] muted">
                  企业拥有者 {currentOrg.owner_username} · {currentOrg.member_count} 名成员
                </p>
              </div>
              <span className="badge accent">{ORG_ROLE_LABELS[currentOrg.role]}</span>
            </div>
            <div className="mt-4 flex gap-2">
              <Link to={orgMembersPath(currentOrg.id)} className="btn ghost sm">
                <Icon name="users" className="ic" />
                成员管理
              </Link>
              <Link to={orgSettingsPath(currentOrg.id)} className="btn ghost sm">
                <Icon name="settings" className="ic" />
                组织设置
              </Link>
            </div>

            <h3 className="card-title mt-6">
              <Icon name="zap" className="ic" />
              快捷入口
            </h3>
            <div className="grid g2 mt-3" style={{ gap: '10px' }}>
              <Link to={chatPath(currentOrg.id)} className="card card-pad quick-card" style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', fontWeight: 600 }}>
                <Icon name="chat" className="ic" style={{ width: 15, height: 15, color: 'var(--accent)' }} />
                发起对话
              </Link>
              <Link to={agentsPath(currentOrg.id)} className="card card-pad quick-card" style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', fontWeight: 600 }}>
                <Icon name="bot" className="ic" style={{ width: 15, height: 15, color: 'var(--accent)' }} />
                新建智能体
              </Link>
              <Link to={knowledgeBasesPath(currentOrg.id)} className="card card-pad quick-card" style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', fontWeight: 600 }}>
                <Icon name="upload" className="ic" style={{ width: 15, height: 15, color: 'var(--accent)' }} />
                上传文档
              </Link>
              <Link to={executionsPath(currentOrg.id)} className="card card-pad quick-card" style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', fontWeight: 600 }}>
                <Icon name="activity" className="ic" style={{ width: 15, height: 15, color: 'var(--accent)' }} />
                执行监控
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <div className="empty mt-6">
          <Icon name="building" className="ic" />
          <p>尚未加入任何组织，创建或加入组织后即可使用全部功能</p>
          <div className="actions">
            <Link to={ROUTE_PATHS.ORGANIZATIONS} className="btn primary">
              <Icon name="plus" className="ic" />
              创建组织
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
