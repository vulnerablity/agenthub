// pages/tools/Form.tsx
// 工具新建/编辑：type 二选一（calculator 固定 expression schema；http 提供 Search/Weather 模板预填）
// schema/config 以 JSON 文本域编辑（提交前校验可解析），对齐 backend ToolCreate/UpdateRequest
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import { toolApi } from '@/api'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { HTTP_TOOL_TEMPLATES, applyTemplate } from '@/constants/tool-templates'
import { toolDetailPath, toolsPath } from '@/constants/routes'
import { useTool } from '@/hooks/useTools'
import type { ToolType } from '@/types'

const CALCULATOR_SCHEMA_TEXT = JSON.stringify(
  {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  null,
  2,
)

export default function ToolForm() {
  const { orgId: orgIdParam, toolId: toolIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const toolId = toolIdParam ? Number(toolIdParam) : null
  const isEdit = toolId != null && !Number.isNaN(toolId)

  const navigate = useNavigate()
  const { data: existing } = useTool(orgId, toolId, isEdit)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<ToolType>('calculator')
  const [schemaText, setSchemaText] = useState(CALCULATOR_SCHEMA_TEXT)
  const [configText, setConfigText] = useState('')
  const [apiError, setApiError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 上次已预填的工具 id：编辑态数据加载后于渲染期同步预填（同 knowledge Form 的官方模式）
  const [loadedToolId, setLoadedToolId] = useState<number | null>(null)

  if (isEdit && existing && loadedToolId !== existing.id) {
    setLoadedToolId(existing.id)
    setName(existing.name)
    setDescription(existing.description ?? '')
    setType(existing.type)
    setSchemaText(JSON.stringify(existing.schema, null, 2))
    setConfigText(existing.config ? JSON.stringify(existing.config, null, 2) : '')
  }

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  if (isEdit && !existing) {
    return <p className="text-sm text-neutral-500">工具不存在</p>
  }

  const handleTemplate = (templateKey: string) => {
    const template = HTTP_TOOL_TEMPLATES.find((t) => t.key === templateKey)
    if (!template) return
    const applied = applyTemplate(
      {
        name: name || template.label,
        type: 'http',
        schema: schemaText.trim() ? safeParse(schemaText) ?? {} : {},
        config: configText.trim() ? safeParse(configText) : null,
      },
      template,
    )
    if (!name) setName(applied.name)
    setDescription(applied.description ?? '')
    setSchemaText(JSON.stringify(applied.schema, null, 2))
    setConfigText(applied.config ? JSON.stringify(applied.config, null, 2) : '')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setApiError('')
    const schema = safeParse(schemaText)
    if (schema == null) {
      setApiError('输入参数 Schema 不是合法 JSON')
      return
    }
    const config = configText.trim() ? safeParse(configText) : null
    if (configText.trim() && config === null) {
      setApiError('工具配置 Config 不是合法 JSON')
      return
    }
    setSubmitting(true)
    try {
      if (isEdit) {
        await toolApi.update(toolId, {
          name,
          description: description || null,
          schema,
          config,
        })
      } else {
        const created = (
          await toolApi.create({ name, description: description || null, type, schema, config })
        ).data
        navigate(toolDetailPath(orgId, created.id))
        return
      }
      navigate(toolDetailPath(orgId, toolId))
    } catch (error) {
      setApiError(errorMessage(error))
      setSubmitting(false)
    }
  }

  const showHttpConfig = type === 'http'

  return (
    <div className="mx-auto max-w-xl">
      <button
        type="button"
        onClick={() =>
          isEdit ? navigate(toolDetailPath(orgId, toolId)) : navigate(toolsPath(orgId))
        }
        className="text-sm text-neutral-500 transition hover:text-neutral-700"
      >
        ← 返回
      </button>

      <h2 className="mt-4 text-xl font-semibold text-neutral-900">
        {isEdit ? '编辑工具' : '新建工具'}
      </h2>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <TextField
          label="名称"
          placeholder="例如：费用计算器"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
        />

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-neutral-700">描述</label>
          <textarea
            rows={3}
            placeholder="工具用途（将作为 LLM 选择工具的依据）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {!isEdit ? (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-neutral-700">工具类型</label>
            <div className="flex gap-2">
              {(
                [
                  { key: 'calculator', label: '计算器', hint: '内置安全表达式求值' },
                  { key: 'http', label: 'HTTP', hint: '通用 webhook 请求' },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setType(option.key)
                    if (option.key === 'calculator') {
                      setSchemaText(CALCULATOR_SCHEMA_TEXT)
                      setConfigText('')
                    }
                  }}
                  className={`flex-1 rounded-xl border-2 px-4 py-3 text-left transition ${
                    type === option.key
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                  }`}
                >
                  <p className="text-sm font-medium text-neutral-900">{option.label}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{option.hint}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showHttpConfig ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-700">HTTP 配置（JSON）</label>
              <div className="flex gap-2">
                {HTTP_TOOL_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => handleTemplate(template.key)}
                    className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs text-emerald-700 transition hover:bg-emerald-50"
                  >
                    {template.label} 模板
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={7}
              spellCheck={false}
              placeholder={'{\n  "url": "https://api.example.com/...",\n  "method": "GET",\n  "headers": {},\n  "body": null\n}'}
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <p className="text-xs text-neutral-400">
              url 支持 {'{key}'} 占位符注入 LLM 传入参数（如 {'{city}'}）；body 为字符串或 JSON 对象
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-neutral-700">
            输入参数 Schema（JSON，决定 LLM 调用参数形状）
          </label>
          {type === 'calculator' ? (
            <p className="text-xs text-neutral-400">计算器参数固定为 expression 字符串，无需修改</p>
          ) : null}
          <textarea
            rows={7}
            spellCheck={false}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {apiError ? <p className="text-sm text-red-500">{apiError}</p> : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '保存中…' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** JSON 文本解析：失败返回 null（由调用方报错），合法对象原样返回 */
function safeParse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}