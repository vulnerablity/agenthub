// pages/chat/Chat.tsx
// 对话页（chat.md 3.3）：左侧会话列表 + 右侧消息区；无选中会话时为欢迎态（新建会话）
// 流式消息为本地临时状态（不进 React Query），done/error 后失效缓存以服务端历史为准
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { conversationApi } from '@/api'
import ChatInput from '@/components/chat/ChatInput'
import MessageBubble from '@/components/chat/MessageBubble'
import SessionList from '@/components/chat/SessionList'
import { canChatAgent } from '@/constants/agent-options'
import { errorMessage } from '@/constants/error-messages'
import { chatConversationPath, chatPath } from '@/constants/routes'
import { useAgents } from '@/hooks/useAgents'
import { conversationsQueryKey, useConversations } from '@/hooks/useConversations'
import { useConversation } from '@/hooks/useConversation'
import { messagesQueryKey, useConversationMessages } from '@/hooks/useConversationMessages'
import { useChatStream } from '@/hooks/useChatStream'
import { useOrg } from '@/hooks/useOrg'
import type { MessageDetail, RAGSource } from '@/types'

/** 乐观追加用户消息用的本地占位（负数 id 与服务端记录区分） */
function localUserMessage(content: string): MessageDetail {
  return {
    id: -Date.now(),
    conversation_id: 0,
    role: 'user',
    content,
    token_usage: null,
    metadata_json: null,
    created_at: new Date().toISOString(),
  }
}

export default function Chat() {
  const { orgId: orgIdParam, conversationId: conversationIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const conversationId = conversationIdParam ? Number(conversationIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: org } = useOrg(orgId)
  const { data: conversations } = useConversations(orgId)
  const { data: agents } = useAgents(orgId, {})
  const { data: conversation } = useConversation(orgId, conversationId)
  const { data: history } = useConversationMessages(orgId, conversationId)

  // 本地消息视图：历史 + 乐观用户气泡 + 流式助手气泡；缓存刷新后以服务端历史为准
  const [messages, setMessages] = useState<MessageDetail[]>([])
  const [streamAssistant, setStreamAssistant] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const deltaCountRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  /** 流终止后失效消息与会话列表缓存（落库的 user/assistant 消息、标题与最后消息摘要） */
  const refreshAfterStream = () => {
    if (conversationId == null) return
    queryClient.invalidateQueries({
      queryKey: messagesQueryKey(orgId ?? 0, conversationId),
    })
    queryClient.invalidateQueries({ queryKey: conversationsQueryKey(orgId ?? 0) })
  }

  const { send, stop, streaming, error: streamSendError } = useChatStream({
    conversationId,
    onDelta: (delta) => {
      deltaCountRef.current += 1
      setStreamAssistant((prev) => (prev ?? '') + delta)
    },
    onDone: (payload) => {
      // 空输出（chat.md D13）：未收到任何 delta 且 message_id 为空 → 提示
      if (payload.message_id == null && deltaCountRef.current === 0) {
        setChatError('模型未返回内容，请重试')
      }
      deltaCountRef.current = 0
      setStreamAssistant(null)
      refreshAfterStream()
    },
    onStreamError: (payload) => {
      deltaCountRef.current = 0
      setStreamAssistant(null)
      setChatError(payload.message)
      refreshAfterStream()
    },
  })

  // 历史视图同步（渲染期间按 props 调整状态的官方模式，避免 effect 内 setState）：
  // 会话切换或缓存刷新（done/error 后失效）时，以服务端历史重置本地视图
  const historyKey = `${conversationId ?? 0}:${history?.length ?? 0}:${history?.at(-1)?.id ?? 0}`
  const [loadedHistoryKey, setLoadedHistoryKey] = useState(historyKey)
  if (loadedHistoryKey !== historyKey) {
    setLoadedHistoryKey(historyKey)
    setMessages(history ?? [])
    setStreamAssistant(null)
    setChatError(null)
  }

  // 自动滚动：流式中强制到底；非流式仅当用户停留在底部附近
  useEffect(() => {
    const el = scrollRef.current
    if (!el || (!streaming && !nearBottomRef.current)) return
    el.scrollTop = el.scrollHeight
  })

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const createConversation = useMutation({
    mutationFn: async (agentId: number) =>
      (await conversationApi.create({ agent_id: agentId })).data,
    onSuccess: (created) => {
      setChatError(null)
      queryClient.invalidateQueries({ queryKey: conversationsQueryKey(orgId ?? 0) })
      navigate(chatConversationPath(orgId!, created.id))
    },
    onError: (error) => setChatError(errorMessage(error)),
  })

  const deleteConversation = useMutation({
    mutationFn: (id: number) => conversationApi.remove(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: conversationsQueryKey(orgId ?? 0) })
      if (deletedId === conversationId) {
        navigate(chatPath(orgId!))
      }
    },
    onError: (error) => setChatError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="text-sm text-neutral-500">组织参数无效</p>
  }

  const canChat = canChatAgent(org?.my_role)
  const enabledAgents = (agents ?? []).filter((agent) => agent.status === 'enabled')
  const conversationAgent = (agents ?? []).find(
    (agent) => agent.id === conversation?.agent_id,
  )
  // 会话对应智能体被停用/缺失时禁止继续对话（后端同样兜底 409）
  const inputDisabled = !canChat || conversationAgent?.status !== 'enabled'
  const fallbackChatError = chatError ?? streamSendError

  const handleSend = (content: string) => {
    if (conversationId == null) return
    setChatError(null)
    deltaCountRef.current = 0
    setMessages((prev) => [...prev, localUserMessage(content)])
    send(content)
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <SessionList
        conversations={conversations ?? []}
        activeId={conversationId}
        agents={enabledAgents}
        creating={createConversation.isPending}
        onSelect={(id) => navigate(chatConversationPath(orgId, id))}
        onCreate={(agentId) => createConversation.mutate(agentId)}
        onDelete={(id) => deleteConversation.mutate(id)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {conversation ? (
          <>
            <header className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
              {conversation.agent_avatar_url ? (
                <img
                  src={conversation.agent_avatar_url}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
                  {conversation.agent_name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <h2 className="text-sm font-semibold text-neutral-900">
                {conversation.agent_name}
              </h2>
              {conversationAgent?.status !== 'enabled' ? (
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-500">
                  智能体已停用，无法继续对话
                </span>
              ) : null}
            </header>

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 space-y-4 overflow-y-auto bg-neutral-50/60 px-5 py-4"
            >
              {messages.length === 0 && !streaming ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <p className="text-sm font-medium text-neutral-700">
                    开始与 {conversation.agent_name} 对话
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">
                    基于该会话创建时绑定的版本配置进行回答
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      role={message.role}
                      content={message.content}
                      sources={
                        message.role === 'assistant'
                          ? (message.metadata_json?.sources as RAGSource[] | undefined)
                          : undefined
                      }
                    />
                  ))}
                  {streaming && streamAssistant != null ? (
                    <MessageBubble role="assistant" content={streamAssistant} streaming />
                  ) : null}
                </>
              )}
            </div>

            {fallbackChatError ? (
              <p className="border-t border-neutral-100 px-5 py-2 text-xs text-red-500">
                {fallbackChatError}
              </p>
            ) : null}

            <div className="border-t border-neutral-100 p-4">
              <ChatInput
                disabled={inputDisabled}
                streaming={streaming}
                onSend={handleSend}
                onStop={() => {
                  deltaCountRef.current = 0
                  stop()
                }}
              />
              {streaming ? (
                <p className="mt-2 text-center text-xs text-neutral-400">
                  生成中，点击「停止」可中断（已生成内容将保留，不视为消息完成）
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <WelcomePanel
            agents={enabledAgents}
            canChat={canChat}
            creating={createConversation.isPending}
            error={fallbackChatError}
            onCreate={(agentId) => createConversation.mutate(agentId)}
          />
        )}
      </div>
    </div>
  )
}

/** 欢迎态：无选中会话时引导选择智能体开始对话 */
function WelcomePanel({
  agents,
  canChat,
  creating,
  error,
  onCreate,
}: {
  agents: { id: number; name: string }[]
  canChat: boolean
  creating: boolean
  error: string | null
  onCreate: (agentId: number) => void
}) {
  const [agentId, setAgentId] = useState<number | null>(null)
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-base font-semibold text-neutral-900">AI 对话</p>
      <p className="mt-1 text-sm text-neutral-500">
        选择一个智能体开始新的对话；左侧面板可切换与管理历史会话
      </p>
      {canChat ? (
        <div className="mt-6 flex w-full max-w-sm items-center gap-2">
          <select
            value={agentId ?? ''}
            onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : null)}
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">选择智能体…</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={agentId == null || creating}
            onClick={() => agentId != null && onCreate(agentId)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? '创建中…' : '开始对话'}
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-neutral-400">当前角色仅可查看，无对话权限</p>
      )}
      {canChat && agents.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-400">
          该组织暂无已启用的智能体，请先在「智能体管理」中创建
        </p>
      ) : null}
      {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}
    </div>
  )
}