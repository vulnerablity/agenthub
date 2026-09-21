// components/chat/MessageBubble.tsx
// 消息气泡：用户右（primary 底）/ 助手左（白底 Markdown 渲染，chat.md D10）；流式未完成时显示光标
import ReactMarkdown from 'react-markdown'

import type { ChatRole } from '@/types'

interface MessageBubbleProps {
  role: ChatRole
  content: string
  /** 流式生成中的临时气泡 */
  streaming?: boolean
}

export default function MessageBubble({ role, content, streaming }: MessageBubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'border border-neutral-200 bg-white text-neutral-900 shadow-sm'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div className="markdown-body break-words [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-neutral-50 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
        {streaming ? (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-indigo-400 align-text-bottom" />
        ) : null}
      </div>
    </div>
  )
}