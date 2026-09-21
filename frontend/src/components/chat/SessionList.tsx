// components/chat/SessionList.tsx
// 会话列表：Agent 选择新建 + 当前用户会话（标题/摘要/时间）+ 选中高亮 + 删除（二次确认）
import { useState } from 'react'

import type { ConversationListItem } from '@/types'
import { AGENT_STATUS_LABELS } from '@/constants/agent-options'
import type { AgentListItem } from '@/types'

interface SessionListProps {
  conversations: ConversationListItem[]
  activeId: number | null
  /** 可用作对话的已启用智能体（新建会话候选） */
  agents: AgentListItem[]
  creating?: boolean
  onSelect: (conversationId: number) => void
  onCreate: (agentId: number) => void
  onDelete: (conversationId: number) => void
}

export default function SessionList({
  conversations,
  activeId,
  agents,
  creating,
  onSelect,
  onCreate,
  onDelete,
}: SessionListProps) {
  const [creatingOpen, setCreatingOpen] = useState(false)
  const [agentId, setAgentId] = useState<number | null>(null)

  const confirmCreate = () => {
    if (agentId != null) {
      onCreate(agentId)
      setCreatingOpen(false)
      setAgentId(null)
    }
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 p-3">
        {creatingOpen ? (
          <div className="flex flex-col gap-2">
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">选择智能体…</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={agentId == null || creating}
                onClick={confirmCreate}
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? '创建中…' : '开始对话'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingOpen(false)
                  setAgentId(null)
                }}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition hover:bg-neutral-100"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingOpen(true)}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            新建会话
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="p-3 text-xs text-neutral-400">暂无会话，点击「新建会话」开始</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId
              // 会话对应智能体被停用时展示状态标签（后端同样拒绝继续对话）
              const agentStatus = agents.find((a) => a.id === conv.agent_id)?.status
              return (
                <li key={conv.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSelect(conv.id)
                    }}
                    className={`group w-full cursor-pointer rounded-xl px-3 py-2 text-left transition ${
                      isActive ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <p
                        className={`min-w-0 flex-1 truncate text-sm ${
                          isActive ? 'font-medium text-indigo-700' : 'text-neutral-900'
                        }`}
                      >
                        {conv.title}
                      </p>
                      {agentStatus != null && agentStatus !== 'enabled' ? (
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                          {AGENT_STATUS_LABELS[agentStatus]}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                      <span className="truncate">{conv.agent_name}</span>
                      {conv.last_message_at ? (
                        <span className="shrink-0">
                          · {new Date(conv.last_message_at).toLocaleString('zh-CN')}
                        </span>
                      ) : null}
                    </p>
                    {conv.last_message_preview ? (
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {conv.last_message_preview}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      aria-label="删除会话"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`确定删除会话「${conv.title}」？`)) {
                          onDelete(conv.id)
                        }
                      }}
                      className="mt-1 hidden text-[11px] text-red-400 transition hover:text-red-600 group-hover:inline"
                    >
                      删除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}