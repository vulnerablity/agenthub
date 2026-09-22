// hooks/useChatStream.ts
// 对话流式发送状态机：idle → streaming → done | error（SSE 状态不进 React Query，由本 hook 独占管理）
// 中止经 AbortController；406/409 等流前错误经 postSse 抛 ApiError 归一提示
import { useCallback, useRef, useState } from 'react'

import { errorMessage } from '@/constants/error-messages'
import type {
  SseDonePayload,
  SseErrorPayload,
  SseToolCallPayload,
  SseToolResultPayload,
} from '@/types'
import { postSse } from '@/utils/sse'

interface UseChatStreamOptions {
  conversationId: number | null
  /** message 事件：增量 delta 回调（由页面累加到流式气泡） */
  onDelta: (delta: string) => void
  /** done 事件：流终止（正常 / 空输出均触发，页面按 message_id 判断） */
  onDone: (payload: SseDonePayload) => void
  /** error 事件：流中失败 */
  onStreamError: (payload: SseErrorPayload) => void
  /** tool_call / tool_result 事件：工具调用过程（tool-calling.md 3.5 chip 展示） */
  onToolCall?: (payload: SseToolCallPayload) => void
  onToolResult?: (payload: SseToolResultPayload) => void
}

export function useChatStream({
  conversationId,
  onDelta,
  onDone,
  onStreamError,
  onToolCall,
  onToolResult,
}: UseChatStreamOptions) {
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    (content: string) => {
      if (conversationId == null || streaming) return
      setError(null)
      setStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller
      postSse(
        `/conversations/${conversationId}/stream`,
        { content },
        {
          onMessage: onDelta,
          onDone: (payload) => {
            setStreaming(false)
            onDone(payload)
          },
          onError: (payload) => {
            setStreaming(false)
            onStreamError(payload)
          },
          onToolCall,
          onToolResult,
        },
        controller.signal,
      ).catch((err: unknown) => {
        setStreaming(false)
        // 用户主动停止（AbortError）不视为错误
        if (err instanceof Error && err.name === 'AbortError') return
        setError(errorMessage(err))
      })
    },
    [conversationId, streaming, onDelta, onDone, onStreamError, onToolCall, onToolResult],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { send, stop, streaming, error }
}