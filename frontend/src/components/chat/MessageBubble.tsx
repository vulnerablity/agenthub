// components/chat/MessageBubble.tsx
// 消息气泡：用户右（渐变底）/ 助手左（白底 Markdown 渲染，chat.md D10）；流式未完成时显示光标
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
    <div className={`msg-row ${isUser ? 'user' : 'ai'}`}>
      <div className={isUser ? 'bubble-user' : 'bubble-ai'}>
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div className="markdown-body break-words [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-[10px] [&_pre]:bg-[#f4f5fb] [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-relaxed">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
        {streaming ? <span className="msg-cursor" /> : null}
        {showTools ? (
          <div className="tool-block">
            <p className="hd">工具调用</p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {toolCalls.map((call, index) => (
                <li key={`${call.round}-${index}`}>
                  <details className="tool-row">
                    <summary>
                      <ToolStatusIcon status={call.status} />
                      <span className="tool-name">{call.name}</span>
                      <span className="tool-args">{JSON.stringify(call.arguments)}</span>
                      <span className="chev">▾</span>
                    </summary>
                    {(call.output ?? '') !== '' ? (
                      <pre className="tool-out">{call.output}</pre>
                    ) : (
                      <p className="tool-out" style={{ color: 'var(--ink-3)' }}>
                        （无输出）
                      </p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {showSources ? (
          <div className="tool-block">
            <p className="hd">引用来源</p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {sources?.map((source, index) => (
                <li key={index}>
                  <details className="src-row">
                    <summary>
                      <span className="src-doc">{source.document}</span>
                      {source.page != null ? (
                        <span className="text-[11.5px] text-[var(--ink-3)]">第 {source.page} 页</span>
                      ) : null}
                      <span className="badge accent" style={{ padding: '1px 7px' }}>
                        {source.score.toFixed(2)}
                      </span>
                      <span className="chev">▾</span>
                    </summary>
                    <p className="src-content">{source.content}</p>
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
    return (
      <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-[#c9cbe9] border-t-[var(--accent)]" />
    )
  }
  return (
    <span
      className={`shrink-0 text-[11px] font-bold ${
        status === 'ok' ? 'text-[var(--success)]' : 'text-[var(--red)]'
      }`}
    >
      {status === 'ok' ? '✓' : '✕'}
    </span>
  )
}
