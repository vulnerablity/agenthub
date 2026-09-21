// components/chat/MessageBubble.tsx
// 消息气泡：用户右（primary 底）/ 助手左（白底 Markdown 渲染，chat.md D10）；流式未完成时显示光标
// 助手消息底部渲染 RAG 引用来源区（文档名/页码/分数，点击展开片段原文，knowledge.md D11）
import ReactMarkdown from 'react-markdown'

import type { ChatRole, RAGSource } from '@/types'

interface MessageBubbleProps {
  role: ChatRole
  content: string
  /** 流式生成中的临时气泡 */
  streaming?: boolean
  /** 引用来源（仅助手消息展示；来自 done.sources 落库后的 metadata_json.sources） */
  sources?: RAGSource[] | null
}

export default function MessageBubble({
  role,
  content,
  streaming,
  sources,
}: MessageBubbleProps) {
  const isUser = role === 'user'
  const showSources = !isUser && !streaming && sources != null && sources.length > 0
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
        {showSources ? (
          <div className="mt-3 border-t border-neutral-100 pt-2">
            <p className="text-xs font-medium text-neutral-500">引用来源</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {sources?.map((source, index) => (
                <li key={index}>
                  <details className="group rounded-lg bg-neutral-50 px-3 py-1.5">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-neutral-600">
                      <span className="min-w-0 flex-1 truncate font-medium text-neutral-700">
                        {source.document}
                      </span>
                      {source.page != null ? (
                        <span className="shrink-0 text-neutral-400">第 {source.page} 页</span>
                      ) : null}
                      <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                        {source.score.toFixed(2)}
                      </span>
                      <span className="shrink-0 text-neutral-300 transition group-open:rotate-180">
                        ▾
                      </span>
                    </summary>
                    <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
                      {source.content}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}