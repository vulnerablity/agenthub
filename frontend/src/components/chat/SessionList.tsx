// components/chat/SessionList.tsx
// 会话列表：Agent 选择新建 + 当前用户会话（标题/摘要/时间）+ 选中高亮 + 删除（二次确认）
import { useState } from 'react'

import Icon from '@/components/Icon'
import type { ConversationListItem, AgentListItem } from '@/types'
import { AGENT_STATUS_LABELS } from '@/constants/agent-options'

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
    <div className="chat-side">
      <div className="chat-side-head">
        {creatingOpen ? (
          <div className="flex flex-col gap-2">
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : null)}
              className="select w-full"
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
                className="btn primary sm flex-1"
              >
                {creating ? '创建中…' : '开始对话'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingOpen(false)
                  setAgentId(null)
                }}
                className="btn ghost sm"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingOpen(true)}
            className="btn primary w-full"
          >
            <Icon name="plus" className="ic" />
            新建会话
          </button>
        )}
      </div>

      <div className="chat-side-body">
        {conversations.length === 0 ? (
          <p className="p-3 text-[12px] muted">暂无会话，点击「新建会话」开始</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
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
                    className={`session-item${isActive ? ' active' : ''}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="t">{conv.title}</p>
                      {agentStatus != null && agentStatus !== 'enabled' ? (
                        <span className="badge off shrink-0" style={{ padding: '0 6px' }}>
                          {AGENT_STATUS_LABELS[agentStatus]}
                        </span>
                      ) : null}
                    </div>
                    <p className="m">
                      <span className="truncate">{conv.agent_name}</span>
                      {conv.last_message_at ? (
                        <span className="shrink-0">
                          · {new Date(conv.last_message_at).toLocaleString('zh-CN')}
                        </span>
                      ) : null}
                    </p>
                    {conv.last_message_preview ? (
                      <p className="p">{conv.last_message_preview}</p>
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
                      className="session-del"
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
