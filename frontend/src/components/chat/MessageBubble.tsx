// components/chat/MessageBubble.tsx
// 消息气泡：用户右（primary 底）/ 助手左（白底 Markdown 渲染，chat.md D10）；流式未完成时显示光标
// 助手消息底部渲染工具调用轨迹（tool-calling.md 3.5：running/ok/error chip，点开看输出）与 RAG 引用来源区（knowledge.md D11）
import ReactMarkdown from 'react-markdown'

import type { ChatRole, RAGSource } from '@/types'

/** 工具调用视图：历史的 ToolCallRun（ok/error）与流式进行中（running）统一形态 */
export interface ToolCallView {
  round: number
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  output?: string
}

interface MessageBubbleProps {
  role: ChatRole
  content: string
  /** 流式生成中的临时气泡 */
  streaming?: boolean
  /** 引用来源（仅助手消息展示；来自 done.sources 落库后的 metadata_json.sources） */
  sources?: RAGSource[] | null
  /** 工具调用轨迹（仅助手消息展示；来自 metadata_json.tool_calls 或流式中的 tool_call 事件） */
  toolCalls?: ToolCallView[] | null
}

export default function MessageBubble({
  role,
  content,
  streaming,
  sources,
  toolCalls,
}: MessageBubbleProps) {
  const isUser = role === 'user'
  const showSources = !isUser && !streaming && sources != null && sources.length > 0
  const showTools = !isUser && toolCalls != null && toolCalls.length > 0
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
        {showTools ? (
          <div className="mt-3 border-t border-neutral-100 pt-2">
            <p className="text-xs font-medium text-neutral-500">工具调用</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {toolCalls.map((call, index) => (
                <li key={`${call.round}-${index}`}>
                  <details className="group rounded-lg bg-neutral-50 px-3 py-1.5">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-neutral-600">
                      <ToolStatusIcon status={call.status} />
                      <span className="min-w-0 flex-1 truncate font-medium text-neutral-700">
                        {call.name}
                      </span>
                      <span className="shrink-0 font-mono text-neutral-400">
                        {JSON.stringify(call.arguments)}
                      </span>
                      <span className="shrink-0 text-neutral-300 transition group-open:rotate-180">
                        ▾
                      </span>
                    </summary>
                    {(call.output ?? '') !== '' ? (
                      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white px-2 py-1.5 font-mono text-xs leading-relaxed text-neutral-600">
                        {call.output}
                      </pre>
                    ) : (
                      <p className="mt-1.5 text-xs text-neutral-400">（无输出）</p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </div>
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

/** 工具调用状态图标：运行中旋转点 / 成功对勾 / 失败叉号 */
function ToolStatusIcon({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') {
    return <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
  }
  return (
    <span
      className={`shrink-0 text-xs font-bold ${
        status === 'ok' ? 'text-emerald-500' : 'text-red-500'
      }`}
    >
      {status === 'ok' ? '✓' : '✕'}
    </span>
  )
}