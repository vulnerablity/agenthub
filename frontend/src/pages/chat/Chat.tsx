// pages/chat/Chat.tsx
// 对话页（方案A重构）：左侧可折叠/可拖拽侧边栏 + 右侧对话面板
// - 侧边栏：功能区「新建对话」+ 会话列表（只显示标题，hover 删除）；右上角收起按钮；面板头部可重新展开
// - 拖拽分隔条调整比例，对话面板至少占一半（侧边栏宽度上限 = 容器一半）
// - 方案A：未选中会话（欢迎态）时在输入框内选择智能体，发送时自动创建会话并进入，随后发送首条消息
// - 流式消息为本地临时状态（不进 React Query），done/error 后失效缓存以服务端历史为准
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { conversationApi } from '@/api'
import ChatInput from '@/components/chat/ChatInput'
import Icon from '@/components/Icon'
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
import type { ToolCallView } from '@/components/chat/MessageBubble'

/** 侧边栏宽度约束：可拖拽范围 200px ~ 容器一半（保证对话面板 ≥ 50%） */
const SIDEBAR_MIN = 200
const SIDEBAR_DEFAULT = 300

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

/** 消息时间（主流样式：MM-DD HH:mm） */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 历史消息 metadata_json.tool_calls → 气泡工具轨迹视图（metadata 无结构保证，容错解析） */
function readToolCalls(metadata: Record<string, unknown> | null | undefined): ToolCallView[] {
  const raw = metadata?.tool_calls
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      round: typeof item.round === 'number' ? item.round : 0,
      name: typeof item.name === 'string' ? item.name : '未知工具',
      arguments:
        item.arguments != null && typeof item.arguments === 'object'
          ? (item.arguments as Record<string, unknown>)
          : {},
      status: item.status === 'error' ? 'error' : 'ok',
      // error 时 output 为空、error 携带原因（后端 tool_calls 轨迹结构）
      output:
        item.status === 'error'
          ? String(item.error ?? item.output ?? '')
          : String(item.output ?? ''),
    }))
}

export default function Chat() {
  const { orgId: orgIdParam, conversationId: conversationIdParam } = useParams()
  const orgId = orgIdParam ? Number(orgIdParam) : null
  const conversationId = conversationIdParam ? Number(conversationIdParam) : null

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sessionSearch, setSessionSearch] = useState('')
  const { data: org } = useOrg(orgId)
  const conversationsQuery = useConversations(orgId, true, sessionSearch)
  const conversations = conversationsQuery.data
  const agentsQuery = useAgents(orgId, {})
  const agents = agentsQuery.data
  const conversationQuery = useConversation(orgId, conversationId)
  const conversation = conversationQuery.data
  const { data: history } = useConversationMessages(orgId, conversationId)

  // ---------- 布局：侧边栏开关 + 拖拽分栏 ----------
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const shellRef = useRef<HTMLDivElement>(null)

  const startResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      const shell = shellRef.current
      // 面板至少占一半 → 侧边栏宽度上限为容器一半
      const max = shell ? Math.floor(shell.clientWidth / 2) : SIDEBAR_DEFAULT
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(startWidth + ev.clientX - startX, max)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
  }

  // ---------- 方案A：欢迎态智能体选择 + 待发送内容 ----------
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const pendingSendRef = useRef<string | null>(null)

  // 本地消息视图：历史 + 乐观用户气泡 + 流式助手气泡；缓存刷新后以服务端历史为准
  const [messages, setMessages] = useState<MessageDetail[]>([])
  const [streamAssistant, setStreamAssistant] = useState<string | null>(null)
  // 流式中的工具调用轨迹（tool_call → running，tool_result → ok/error 并附输出）
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCallView[]>([])
  const [chatError, setChatError] = useState<string | null>(null)
  const [retryContent, setRetryContent] = useState<string | null>(null)
  const lastSubmittedRef = useRef<string | null>(null)
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
      setLiveToolCalls([])
      setRetryContent(null)
      refreshAfterStream()
    },
    onStreamError: (payload) => {
      deltaCountRef.current = 0
      setStreamAssistant(null)
      setLiveToolCalls([])
      setChatError(payload.message)
      setRetryContent(lastSubmittedRef.current)
      refreshAfterStream()
    },
    onToolCall: (payload) => {
      // 新一次调用进入 running 态（tool_result 按序配对更新，见 onToolResult）
      setLiveToolCalls((prev) => [
        ...prev,
        { round: payload.round, name: payload.name, arguments: payload.arguments, status: 'running' },
      ])
    },
    onToolResult: (payload) => {
      setLiveToolCalls((prev) =>
        prev.map((call, index) => {
          // 后端 tool_call/tool_result 严格按序成对发出：更新首个仍为 running 的调用
          const firstRunning = prev.findIndex((item) => item.status === 'running')
          if (index === firstRunning) {
            return {
              round: payload.round,
              name: payload.name,
              arguments: call.arguments,
              status: payload.status,
              output: payload.output,
            }
          }
          return call
        }),
      )
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
    setLiveToolCalls([])
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

  /** 真正发起流式：乐观上屏用户消息 + SSE 发送 */
  const doSend = (content: string, cid: number) => {
    setChatError(null)
    setRetryContent(null)
    lastSubmittedRef.current = content
    deltaCountRef.current = 0
    setLiveToolCalls([])
    setMessages((prev) => [...prev, localUserMessage(content)])
    send(content, cid)
  }

  /** 方案A：进入新创建的会话后，自动发送待发内容（等会话详情加载完成，避免乐观消息被历史重置清掉） */
  useEffect(() => {
    if (conversationId == null || conversation == null || pendingSendRef.current == null) return
    const content = pendingSendRef.current
    pendingSendRef.current = null
    doSend(content, conversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conversation])

  const createConversation = useMutation({
    mutationFn: async (agentId: number) =>
      (await conversationApi.create({ agent_id: agentId })).data,
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

  const renameConversation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) => conversationApi.update(id, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsQueryKey(orgId ?? 0) }),
    onError: (error) => setChatError(errorMessage(error)),
  })

  if (orgId == null || Number.isNaN(orgId)) {
    return <p className="muted">组织参数无效</p>
  }

  const canChat = canChatAgent(org?.my_role)
  const enabledAgents = (agents ?? []).filter((agent) => agent.status === 'enabled')
  const conversationAgent = (agents ?? []).find(
    (agent) => agent.id === conversation?.agent_id,
  )
  // 会话对应智能体被停用/缺失时禁止继续对话（后端同样兜底 409）
  const inputDisabled = !canChat || conversationAgent?.status !== 'enabled'
  const fallbackChatError = chatError ?? streamSendError

  const handleSend = async (content: string) => {
    if (conversationId != null) {
      doSend(content, conversationId)
      return
    }
    // 方案A：未进入会话时，须先选择智能体；已选则创建会话并跳转，随后自动发送
    // 创建进行中忽略重复点击（防重复建会话）
    if (createConversation.isPending) return
    if (selectedAgentId == null) {
      setChatError('请先选择智能体')
      return
    }
    setChatError(null)
    try {
      const created = await createConversation.mutateAsync(selectedAgentId)
      pendingSendRef.current = content
      queryClient.invalidateQueries({ queryKey: conversationsQueryKey(orgId ?? 0) })
      navigate(chatConversationPath(orgId!, created.id))
    } catch (error) {
      setChatError(errorMessage(error))
    }
  }

  return (
    <div className="chat-shell" ref={shellRef}>
      {sidebarOpen ? (
        <>
          <div className="chat-side" style={{ width: sidebarWidth }}>
            <SessionList
              conversations={conversations ?? []}
              activeId={conversationId}
              onSelect={(id) => navigate(chatConversationPath(orgId, id))}
              onDelete={(id) => deleteConversation.mutate(id)}
              onRename={(id, title) => renameConversation.mutate({ id, title })}
              search={sessionSearch}
              onSearch={setSessionSearch}
              isLoading={conversationsQuery.isPending}
              loadError={conversationsQuery.isError}
              onRetryLoad={() => void conversationsQuery.refetch()}
              onNewChat={() => navigate(chatPath(orgId))}
              onToggleSidebar={() => {setSidebarOpen(false)
                setSidebarWidth(SIDEBAR_DEFAULT)
              }}
            />
          </div>
          <div className="chat-resizer" onMouseDown={startResize} title="拖动调整宽度" />
        </>
      ) : null}

      <div className="chat-main">
        <header className="chat-head">
          {!sidebarOpen ? (
            <button
              type="button"
              className="head-side-btn"
              title="展开侧边栏"
              onClick={() => setSidebarOpen(true)}
            >
              <Icon name="panel-left" className="ic" />
            </button>
          ) : (
            <span />
          )}
          <div className="ch-title">
            {conversation ? (
              <>
                {conversation.agent_avatar_url ? (
                  <img
                    src={conversation.agent_avatar_url}
                    alt=""
                    className="avatar sm shrink-0 object-cover"
                  />
                ) : (
                  <span className={`avatar sm ${avatarTone(conversation.agent_name)}`}>
                    {conversation.agent_name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <h2 className="ch-name">{conversation.agent_name}</h2>
                {conversationAgent?.status !== 'enabled' ? (
                  <span className="badge off">智能体已停用，无法继续对话</span>
                ) : null}
              </>
            ) : (
              <h2 className="ch-name">请选择智能体</h2>
            )}
          </div>
          <span />
        </header>

        <div ref={scrollRef} onScroll={handleScroll} className="msg-list">
          {conversationId != null && conversationQuery.isPending ? (
            <div className="welcome"><p>正在加载会话…</p></div>
          ) : conversationId != null && conversationQuery.isError ? (
            <div className="welcome"><p className="text-red-600">会话加载失败或无权访问。</p><button type="button" className="btn ghost sm mt-3" onClick={() => void conversationQuery.refetch()}>重试</button></div>
          ) : conversation == null ? (
            <div className="welcome">
              <span className="avatar lg av-1">
                <span className="text-[22px]">✦</span>
              </span>
              <p className="mt-4 text-[16px] font-bold">有问题，随便问</p>
              <p className="mt-1 text-[13px] muted">
                在下方选择一个智能体，输入内容即可开始对话
              </p>
              {!canChat ? (
                <p className="mt-3 text-[13px] muted">当前角色仅可查看，无对话权限</p>
              ) : null}
              {agentsQuery.isPending ? <p className="mt-3 text-[12px] muted">正在加载智能体…</p> : null}
              {agentsQuery.isError ? <p className="mt-3 text-[12px] text-red-500">智能体列表加载失败，请刷新后重试。</p> : null}
              {canChat && !agentsQuery.isPending && enabledAgents.length === 0 ? (
                <p className="mt-3 text-[12px] muted">
                  该组织暂无已启用的智能体，请先在「智能体管理」中创建
                </p>
              ) : null}
            </div>
          ) : messages.length === 0 && !streaming ? (
            <div className="welcome">
              <p className="text-[14px] font-semibold text-[var(--ink-1)]">
                开始与 {conversation.agent_name} 对话
              </p>
              <p className="mt-1 text-[12px] muted">
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
                  time={
                    message.role === 'assistant' ? formatTime(message.created_at) : null
                  }
                  agentName={
                    message.role === 'assistant' ? conversation?.agent_name : null
                  }
                  orgId={orgId}
                  sources={
                    message.role === 'assistant'
                      ? (message.metadata_json?.sources as RAGSource[] | undefined)
                      : undefined
                  }
                  toolCalls={
                    message.role === 'assistant'
                      ? readToolCalls(message.metadata_json)
                      : null
                  }
                />
              ))}
              {streaming && streamAssistant != null ? (
                <MessageBubble
                  role="assistant"
                  content={streamAssistant}
                  streaming
                  toolCalls={liveToolCalls.length > 0 ? liveToolCalls : null}
                />
              ) : null}
            </>
          )}
        </div>

        {fallbackChatError ? (
          <div className="flex items-center justify-center gap-3 border-t border-[var(--line)] px-4 py-2 text-[12px] text-red-500">
            <span>{fallbackChatError}</span>
            {retryContent && conversationId != null && !streaming ? (
              <button
                type="button"
                className="btn ghost xs"
                onClick={() => {
                  setChatError(null)
                  setStreamAssistant('')
                  setLiveToolCalls([])
                  deltaCountRef.current = 0
                  send(retryContent, conversationId, true)
                }}
              >重试回答</button>
            ) : null}
          </div>
        ) : null}

        <div className="chat-input">
          <ChatInput
            disabled={inputDisabled}
            streaming={streaming}
            onSend={handleSend}
            onStop={() => {
              deltaCountRef.current = 0
              stop()
              setRetryContent(lastSubmittedRef.current)
              setChatError('已停止生成，可重试回答')
            }}
            showAgentPicker={conversationId == null}
            agents={enabledAgents}
            agentId={conversationId == null ? selectedAgentId : null}
            onSelectAgent={setSelectedAgentId}
          />
          {streaming ? (
            <p className="mt-2 text-center text-[12px] muted">
              生成中，点击「停止」可中断（已生成内容将保留，不视为消息完成）
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 根据名称稳定映射头像渐变 */
function avatarTone(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 997
  }
  return `av-${(hash % 6) + 1}`
}
