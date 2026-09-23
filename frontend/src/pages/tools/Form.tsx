// pages/tools/Form.tsx
// 工具新建/编辑：type 二选一（calculator 固定 expression schema；http 提供 Search/Weather 模板预填）
// schema/config 以 JSON 文本域编辑（提交前校验可解析），对齐 backend ToolCreate/UpdateRequest
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import { toolApi } from '@/api'
import Icon from '@/components/Icon'
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
    return <p className="muted">组织参数无效</p>
  }

  if (isEdit && !existing) {
    return <p className="muted">工具不存在</p>
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
        className="btn ghost xs"
      >
        <Icon name="back" className="ic" />
        返回
      </button>

      <div className="page-head mt-4">
        <div>
          <h1 className="page-title">{isEdit ? '编辑工具' : '新建工具'}</h1>
          <p className="page-sub">Agent 可调用的外部工具（计算器 / HTTP）</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card card-pad mt-5 flex flex-col gap-5">
        <TextField
          label="名称"
          placeholder="例如：费用计算器"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
        />

        <div className="field">
          <label className="lbl">描述</label>
          <textarea
            rows={3}
            placeholder="工具用途（将作为 LLM 选择工具的依据）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            className="w-full resize-y rounded-[10px] border border-[var(--line-2)] px-3.5 py-2.5 outline-none transition placeholder:text-[#b3b9ce] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#e4e6ff]"
          />
        </div>

        {!isEdit ? (
          <div className="field">
            <label className="lbl">工具类型</label>
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
                  className={`flex-1 rounded-[12px] border-2 px-4 py-3 text-left transition ${
                    type === option.key
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] bg-white hover:border-[#cfd3e4]'
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                    <Icon
                      name={option.key === 'calculator' ? 'zap' : 'globe'}
                      width={15}
                      height={15}
                      style={{ color: 'var(--accent-ink)' }}
                    />
                    {option.label}
                  </p>
                  <p className="mt-0.5 text-[12px] muted">{option.hint}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showHttpConfig ? (
          <div className="field">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="lbl">HTTP 配置（JSON）</label>
              <div className="flex gap-2">
                {HTTP_TOOL_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => handleTemplate(template.key)}
                    className="btn xs ghost"
                    style={{ color: 'var(--success)', borderColor: '#b9e4d6' }}
                  >
                    {template.label} 模板
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={7}
              spellCheck={false}
              placeholder={
                '{\n  "url": "https://api.example.com/...",\n  "method": "GET",\n  "headers": {},\n  "body": null\n}'
              }
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              className="w-full resize-y rounded-[10px] border border-[var(--line-2)] px-3.5 py-2.5 mono text-[12px] outline-none transition placeholder:text-[#b3b9ce] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#e4e6ff]"
            />
            <p className="mt-1 text-[12px] muted">
              url 支持 {'{key}'} 占位符注入 LLM 传入参数（如 {'{city}'}）；body 为字符串或 JSON 对象
            </p>
          </div>
        ) : null}

        <div className="field">
          <label className="lbl">输入参数 Schema（JSON，决定 LLM 调用参数形状）</label>
          {type === 'calculator' ? (
            <p className="mt-1 text-[12px] muted">计算器参数固定为 expression 字符串，无需修改</p>
          ) : null}
          <textarea
            rows={7}
            spellCheck={false}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            className="mt-1 w-full resize-y rounded-[10px] border border-[var(--line-2)] px-3.5 py-2.5 mono text-[12px] outline-none transition placeholder:text-[#b3b9ce] focus:border-[var(--accent)] focus:ring-2 focus:ring-[#e4e6ff]"
          />
        </div>

        {apiError ? <p className="text-[13px] text-red-500">{apiError}</p> : null}

        <div className="row-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              isEdit ? navigate(toolDetailPath(orgId, toolId)) : navigate(toolsPath(orgId))
            }
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="btn primary"
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
