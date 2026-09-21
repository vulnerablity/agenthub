// utils/sse.ts
// SSE 流式请求（POST + fetch）：axios 不支持流式响应，本模块自行解析事件帧并归一错误
// 与 REST 拦截器行为对齐：手动携带 Token 与 X-Organization-Id；401 复用 http.ts 的全局登出回调
import type { ApiErrorBody } from '@/types/http'
import { ApiError } from '@/types/http'
import type { SseDonePayload, SseErrorPayload } from '@/types/chat'

import { BASE_URL, getCurrentOrgId, triggerUnauthorized } from './http'
import { getAccessToken } from './token'

export interface SseHandlers {
  /** message 事件：增量 delta 片段，客户端按序拼接 */
  onMessage: (delta: string) => void
  /** done 事件：终止帧（message_id / token_usage） */
  onDone: (payload: SseDonePayload) => void
  /** error 事件：流中失败（流前失败以 ApiError 抛出） */
  onError: (payload: SseErrorPayload) => void
}

/** POST 流式请求：仅处理 200；非 200 读取统一 JSON 错误体并抛 ApiError（409/404/422 等流前错误） */
export async function postSse(
  path: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAccessToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const orgId = getCurrentOrgId()
  if (orgId != null) {
    headers['X-Organization-Id'] = String(orgId)
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    if (response.status === 401) {
      triggerUnauthorized()
    }
    let payload: ApiErrorBody | null = null
    try {
      payload = (await response.json()) as ApiErrorBody
    } catch {
      // 非 JSON 错误体走兜底
    }
    if (payload && typeof payload.code === 'string' && typeof payload.message === 'string') {
      throw new ApiError(response.status, payload)
    }
    throw new ApiError(response.status, {
      code: 'HTTP_ERROR',
      message: `请求失败（${response.status}）`,
      detail: null,
    })
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 帧以空行分隔：event: xxx / data: {...} / 空行
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of frame.split('\n')) {
          const trimmed = line.replace(/\r$/, '')
          if (trimmed.startsWith('event:')) {
            eventType = trimmed.slice(6).trim()
          } else if (trimmed.startsWith('data:')) {
            const raw = trimmed.slice(5).trim()
            try {
              const data = JSON.parse(raw) as Record<string, unknown>
              if (eventType === 'message') {
                handlers.onMessage(String(data.delta ?? ''))
              } else if (eventType === 'done') {
                handlers.onDone(data as unknown as SseDonePayload)
              } else if (eventType === 'error') {
                handlers.onError(data as unknown as SseErrorPayload)
              }
            } catch {
              // 无法解析的数据帧静默跳过
            }
          }
        }
        eventType = ''
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}