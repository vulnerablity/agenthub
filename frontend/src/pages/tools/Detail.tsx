// pages/tools/Detail.tsx
// 工具详情：概览 + schema/config 只读展示 + 「测试运行」表单（需求 3.7 POST /tools/{id}/test）+ 编辑/删除
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import Icon from '@/components/Icon'
import { canManageAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { toolEditPath, toolsPath } from '@/constants/routes'
import { useDeleteTool, useTestTool, useTool } from '@/hooks/useTools'
import { useOrg } from '@/hooks/useOrg'

const TYPE_LABELS: Record<string, string> = { calculator: '计算器', http: 'HTTP' }

export default function ToolDetail() {
  const { orgId: orgIdParam, toolId: toolIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const toolId = toolIdParam ? Number(toolIdParam) : null

  const navigate = useNavigate()
  const { data: org } = useOrg(orgId)
  const { data: tool, isPending } = useTool(orgId, toolId)
  const [argumentsText, setArgumentsText] = useState('{}')
  const [apiError, setApiError] = useState('')
  const canManage = canManageAgent(org?.my_role)

  const testMutation = useTestTool()
  const deleteMutation = useDeleteTool(orgId ?? 0)

  const handleTest = async () => {
    setApiError('')
    try {
      const args = JSON.parse(argumentsText) as unknown
      if (args == null || typeof args !== 'object' || Array.isArray(args)) {
        setApiError('arguments 必须是 JSON 对象')
        return
      }
      await testMutation.mutateAsync({
        toolId: toolId!,
        data: { arguments: args as Record<string, unknown> },
      })
    } catch (error) {
      setApiError(errorMessage(error))
    }
  }

  if (orgId == null || toolId == null || Number.isNaN(orgId) || Number.isNaN(toolId)) {
    return <p className="muted">参数无效</p>
  }

  if (isPending) {
    return <p className="muted">加载中…</p>
  }

  if (!tool) {
    return <p className="muted">工具不存在</p>
  }

  const test = testMutation.data
  const handleDelete = () => {
    setApiError('')
    if (window.confirm(`确定删除工具「${tool.name}」？此操作不可撤销。`)) {
      deleteMutation.mutate(tool.id, {
        onSuccess: () => navigate(toolsPath(orgId)),
        onError: (error) => setApiError(errorMessage(error)),
      })
    }
  }

  return (
    <div>
      <button type="button" onClick={() => navigate(toolsPath(orgId))} className="btn ghost xs">
        <Icon name="back" className="ic" />
        返回工具列表
      </button>

      <div className="card card-pad mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`avatar lg ${tool.type === 'http' ? 'av-2' : 'av-3'}`}>
            <Icon name={tool.type === 'http' ? 'globe' : 'zap'} width={20} height={20} />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="page-title">{tool.name}</h2>
              <span className={`badge ${tool.type === 'http' ? 'info' : 'accent'}`}>
                {TYPE_LABELS[tool.type] ?? tool.type}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] muted">
              更新于 {new Date(tool.updated_at).toLocaleString('zh-CN')}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="row-actions">
            <button
              type="button"
              onClick={() => navigate(toolEditPath(orgId, tool.id))}
              className="btn ghost sm"
            >
              <Icon name="edit" className="ic" />
              编辑
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
              className="btn sm danger-ghost"
            >
              {deleteMutation.isPending ? '删除中…' : '删除'}
            </button>
          </div>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-[13px] text-red-500">{apiError}</p> : null}

      <div className="grid g2 mt-5">
        <section className="card card-pad">
          <h3 className="card-title">
            <Icon name="settings" className="ic" />
            配置
          </h3>
          <dl className="kv mt-3">
            <div className="row">
              <dt>描述</dt>
              <dd>{tool.description || '暂无描述'}</dd>
            </div>
            <div className="row">
              <dt>创建时间</dt>
              <dd>{new Date(tool.created_at).toLocaleString('zh-CN')}</dd>
            </div>
            <div className="row">
              <dt>更新时间</dt>
              <dd>{new Date(tool.updated_at).toLocaleString('zh-CN')}</dd>
            </div>
          </dl>
          <div className="mt-2">
            <dt className="muted text-[12px] font-medium">输入参数 Schema</dt>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-[10px] bg-[#f8f9fd] p-3.5 mono leading-relaxed text-[#141731]">
              {JSON.stringify(tool.schema, null, 2)}
            </pre>
          </div>
          {tool.type === 'http' ? (
            <div className="mt-2">
              <dt className="muted text-[12px] font-medium">HTTP 配置</dt>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-[10px] bg-[#f8f9fd] p-3.5 mono leading-relaxed text-[#141731]">
                {JSON.stringify(tool.config ?? {}, null, 2)}
              </pre>
            </div>
          ) : null}
        </section>

        {canManage ? (
          <section className="card card-pad">
            <h3 className="card-title">
              <Icon name="zap" className="ic" />
              测试运行
            </h3>
            <div className="field mt-4">
              <label className="lbl">输入参数（JSON，对应 Schema 定义的参数）</label>
              <textarea
                rows={5}
                spellCheck={false}
                value={argumentsText}
                onChange={(e) => setArgumentsText(e.target.value)}
                className="w-full resize-y rounded-[10px] border border-[var(--line-2)] px-3.5 py-2.5 mono text-[12.5px] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[#e4e6ff]"
              />
            </div>
            <button
              type="button"
              disabled={testMutation.isPending}
              onClick={handleTest}
              className="btn primary sm mt-2"
            >
              {testMutation.isPending ? '执行中…' : '执行测试'}
            </button>

            {test ? (
              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <div className="flex items-center gap-3">
                  <span className={`badge ${test.status === 'ok' ? 'ok' : 'err'}`}>
                    {test.status === 'ok' ? '成功' : '失败'}
                  </span>
                  <span className="text-[12px] muted">
                    耗时 <span className="mono">{test.duration_ms}</span> ms
                  </span>
                </div>
                {test.status === 'ok' ? (
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-[10px] bg-[#f8f9fd] p-3.5 mono text-[12px] leading-relaxed text-[#141731]">
                    {test.output}
                  </pre>
                ) : (
                  <p className="mt-3 text-[13px] text-red-600">{test.error ?? test.output}</p>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
