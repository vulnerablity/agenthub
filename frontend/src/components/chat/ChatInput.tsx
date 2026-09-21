// components/chat/ChatInput.tsx
// 输入区：自适应高度 textarea（Enter 发送 / Shift+Enter 换行）；流式中按钮切换为停止
import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

interface ChatInputProps {
  disabled?: boolean
  streaming?: boolean
  onSend: (content: string) => void
  onStop?: () => void
}

export default function ChatInput({
  disabled,
  streaming,
  onSend,
  onStop,
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={disabled ? '暂不可对话' : '输入消息，Enter 发送 / Shift+Enter 换行'}
        onChange={(e) => setValue(e.target.value)}
        onInput={autoGrow}
        onKeyDown={handleKeyDown}
        className="max-h-40 flex-1 resize-none rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-xl border border-neutral-300 px-5 py-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
        >
          停止
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          发送
        </button>
      )}
    </form>
  )
}