// components/chat/SessionList.tsx
// 侧边栏（方案A）：功能区「新建对话」（图标+文字居左）+ 右上角收起按钮；
// 下方会话列表只展示对话标题，悬浮项显示灰色背景 + 标题右侧红色细字「删除」
import Icon from '@/components/Icon'
import type { ConversationListItem } from '@/types'

interface SessionListProps {
  conversations: ConversationListItem[]
  activeId: number | null
  onSelect: (conversationId: number) => void
  onDelete: (conversationId: number) => void
  /** 回到欢迎态（未选中会话），在输入框内重新选择智能体 */
  onNewChat: () => void
  /** 收起侧边栏 */
  onToggleSidebar: () => void
}

export default function SessionList({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
  onToggleSidebar,
}: SessionListProps) {
  return (
    <div className="chat-side">
      <div className="chat-side-head">
        <button
          type="button"
          className="side-toggle"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          onClick={onToggleSidebar}
        >
          <Icon name="back" className="ic" />
        </button>
      </div>
      <div className="chat-side-func">
              <button type="button" className="btn-new" onClick={onNewChat}>
          <Icon name="plus" className="ic" />
          新建对话
        </button>
      </div>
      <div className="chat-side-body">
        {conversations.length === 0 ? (
          <p className="side-empty">暂无对话，点击「新建对话」开始</p>
        ) : (
          <ul className="side-list">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId
              return (
                <li key={conv.id} className={`session-item${isActive ? ' active' : ''}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    className="session-row"
                    onClick={() => onSelect(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSelect(conv.id)
                    }}
                  >
                    <span className="t" title={conv.title}>
                      {conv.title}
                    </span>
                    <button
                      type="button"
                      className="session-del"
                      aria-label="删除会话"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`确定删除会话「${conv.title}」？`)) {
                          onDelete(conv.id)
                        }
                      }}
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
