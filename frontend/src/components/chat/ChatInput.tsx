// components/chat/ChatInput.tsx
// 输入区（方案A）：白底椭圆输入框，从左到右 = 加号(上传未开发) + 自适应 textarea + 智能体选择器(仅欢迎态) + 圆形发送按钮
// 多行时输入框向上生长（.ci-box align-items:flex-end）；发送按钮：无内容置灰，有内容蓝色白箭头
import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import Icon from '@/components/Icon'
import type { AgentListItem } from '@/types'

interface ChatInputProps {
  disabled?: boolean
  streaming?: boolean
  onSend: (content: string) => void
  onStop?: () => void
  /** 方案A：仅未选中会话（欢迎态）时展示智能体选择器；进入会话后隐藏 */
  showAgentPicker?: boolean
  agents?: AgentListItem[]
  agentId?: number | null
  onSelectAgent?: (agentId: number) => void
}

const MAX_TA_HEIGHT = 120

export default function ChatInput({
  disabled,
  streaming,
  onSend,
  onStop,
  showAgentPicker,
  agents = [],
  agentId,
  onSelectAgent,
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const hasContent = value.trim() !== ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const content = value.trim()
    if (!content || streaming || disabled) return
    onSend(content)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 组合键输入（中文输入法确认）不触发发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit(e)
    }
  }

  /** 多行向上生长：高度随内容自增，容器底部对齐（flex-end），视觉上向消息区上方扩展 */
  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TA_HEIGHT)}px`
  }

  /** 加号：上传图片/文件/文件夹（仅样式，功能未开发 → 短暂提示） */
  const handlePlus = () => {
    setNotice('图片 / 文件 / 文件夹上传功能未开发')
    if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2600)
  }

  return (
    <div className="ci-wrap">
      {notice ? <p className="ci-notice">{notice}</p> : null}
      <form onSubmit={submit} className="ci-box">
        <button type="button" className="ci-plus" title="上传图片/文件/文件夹" onClick={handlePlus}>
          <Icon name="add" className="ic" />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={disabled ? '暂不可对话' : '有问题，随便问'}
          onChange={(e) => setValue(e.target.value)}
          onInput={autoGrow}
          onKeyDown={handleKeyDown}
          className="ci-ta"
        />
        {showAgentPicker ? (
          <AgentPicker agents={agents} value={agentId ?? null} onChange={onSelectAgent} disabled={disabled} />
        ) : null}
        {streaming ? (
          <button type="button" className="ci-send stop" onClick={onStop} title="停止生成">
            <Icon name="stop" className="ic" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !hasContent}
            className={`ci-send${hasContent ? ' on' : ''}`}
            title="发送"
          >
            <span className="ci-send-arrow">↑</span>
          </button>
        )}
      </form>
    </div>
  )
}

/** 智能体选择器：输入框右侧"智能体 ▾"，点击展开候选（向上弹出），选中即收起 */
function AgentPicker({
  agents,
  value,
  onChange,
  disabled,
}: {
  agents: AgentListItem[]
  value: number | null
  onChange?: (agentId: number) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = agents.find((a) => a.id === value)
  return (
    <div className="ci-agent">
      <button
        type="button"
        className="ci-agent-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="agent-name">{selected ? selected.name : '智能体'}</span>
        <Icon name="chev-down" className="ic caret" />
      </button>
      {open ? (
        <>
          <div className="ci-agent-mask" onClick={() => setOpen(false)} />
          <ul className="ci-agent-menu">
            {agents.length === 0 ? (
              <li className="empty">该组织暂无已启用智能体</li>
            ) : (
              agents.map((a) => (
                <li
                  key={a.id}
                  className={a.id === value ? 'sel' : ''}
                  onClick={() => {
                    onChange?.(a.id)
                    setOpen(false)
                  }}
                >
                  {a.name}
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}
    </div>
  )
}
