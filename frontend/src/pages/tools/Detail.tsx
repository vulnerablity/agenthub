// pages/tools/Detail.tsx
// 工具详情：概览 + schema/config 只读展示 + 「测试运行」表单（需求 3.7 POST /tools/{id}/test）+ 编辑/删除
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

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
    return <p className="text-sm text-neutral-500">参数无效</p>
  }

  if (isPending) {
    return <p className="text-sm text-neutral-500">加载中…</p>
  }

  if (!tool) {
    return <p className="text-sm text-neutral-500">工具不存在</p>
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
    <div className="mx-auto max-w-4xl">
      <button
        type="button"
        onClick={() => navigate(toolsPath(orgId))}
        className="text-sm text-neutral-500 transition hover:text-neutral-700"
      >
        ← 返回工具列表
      </button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-base font-medium text-indigo-700">
            {tool.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-neutral-900">{tool.name}</h2>
              <span className="rounded-full bg-neutral-100 px-3 py-0.5 text-xs font-medium text-neutral-600">
                {TYPE_LABELS[tool.type] ?? tool.type}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-neutral-400">
              更新于 {new Date(tool.updated_at).toLocaleString('zh-CN')}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(toolEditPath(orgId, tool.id))}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              编辑
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteMutation.isPending ? '删除中…' : '删除'}
            </button>
          </div>
        ) : null}
      </div>

      {apiError ? <p className="mt-4 text-sm text-red-500">{apiError}</p> : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">配置</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-neutral-400">描述</dt>
              <dd className="mt-1 text-neutral-900">{tool.description || '暂无描述'}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">输入参数 Schema</dt>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-800">
                {JSON.stringify(tool.schema, null, 2)}
              </pre>
            </div>
            {tool.type === 'http' ? (
              <div>
                <dt className="text-neutral-400">HTTP 配置</dt>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-800">
                  {JSON.stringify(tool.config ?? {}, null, 2)}
                </pre>
              </div>
            ) : null}
          </dl>
        </section>

        {canManage ? (
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-neutral-900">测试运行</h3>
            <label className="mt-4 block text-sm font-medium text-neutral-700">
              输入参数（JSON，对应 Schema 定义的参数）
            </label>
            <textarea
              rows={5}
              spellCheck={false}
              value={argumentsText}
              onChange={(e) => setArgumentsText(e.target.value)}
              className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="button"
              disabled={testMutation.isPending}
              onClick={handleTest}
              className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testMutation.isPending ? '执行中…' : '执行测试'}
            </button>

            {test ? (
              <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4 text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-0.5 text-xs font-medium ${
                      test.status === 'ok'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    {test.status === 'ok' ? '成功' : '失败'}
                  </span>
                  <span className="text-xs text-neutral-400">
                    耗时 {test.duration_ms} ms
                  </span>
                </div>
                {test.status === 'ok' ? (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 font-mono text-xs text-neutral-800">
                    {test.output}
                  </pre>
                ) : (
                  <p className="text-sm text-red-600">{test.error ?? test.output}</p>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}