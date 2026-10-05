// components/layout/AppLayout.tsx
// 受保护区域布局：左侧深色侧边栏（品牌 + 组织切换 + 分组导航 + 用户）+ 右侧内容区 Outlet
import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import Icon from '@/components/Icon'
import {
  agentsPath,
  chatPath,
  executionsPath,
  knowledgeBasesPath,
  modelProvidersPath,
  orgMembersPath,
  orgSettingsPath,
  ROUTE_PATHS,
  toolsPath,
} from '@/constants/routes'
import { canChatAgent } from '@/constants/agent-options'
import { ORG_ROLE_LABELS } from '@/constants/org-roles'
import { useMe } from '@/hooks/useMe'
import { useOrg } from '@/hooks/useOrg'
import { useAuthStore } from '@/stores/auth'
import { useOrganizationStore } from '@/stores/organization'
import { queryClient } from '@/utils/query-client'
import { clearTokens } from '@/utils/token'

import OrgSwitcher from './OrgSwitcher'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `nav-item${isActive ? ' active' : ''}`

/** 无组织时置灰的导航项（与后端权限一致：组织相关功能依赖当前组织） */
function OrgDisabledItem({ icon, label }: { icon: 'settings' | 'users' | 'bot' | 'book' | 'wrench' | 'chat' | 'activity' | 'layers'; label: string }) {
  return (
    <span className="nav-item disabled" title="请先创建或加入组织">
      <Icon name={icon} className="ic" />
      {label}
    </span>
  )
}

export default function AppLayout() {
  const navigate = useNavigate()
  const signOut = useAuthStore((state) => state.signOut)
  const currentOrgId = useOrganizationStore((state) => state.currentOrgId)
  const setCurrentOrg = useOrganizationStore((state) => state.setCurrentOrg)
  const { data: me } = useMe()
  const { data: currentOrg } = useOrg(currentOrgId)

  const handleLogout = () => {
    clearTokens()
    queryClient.clear()
    setCurrentOrg(null)
    signOut()
    navigate(ROUTE_PATHS.LOGIN, { replace: true })
  }

  const orgNavDisabled = currentOrgId == null
  const canManageOrganization = currentOrg?.my_role === 'owner' || currentOrg?.my_role === 'admin'
  const canSeeExecutions = canChatAgent(currentOrg?.my_role)

  const [showUserMenu, setShowUserMenu] = useState(false);
  const handleOpenUserMenu = (e:React.MouseEvent) => {
  e.stopPropagation();
  setShowUserMenu(v => !v);
};
  useEffect(() => {
    const close = (e: MouseEvent) => {
      e.stopPropagation();
      setShowUserMenu(false);
    };
    if (showUserMenu) document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showUserMenu]);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sb-logo">
          <span className="tb-logo">
            <Icon name="spark" width={17} height={17} color="#fff" />
          </span>
          <span>
            <b>AgentHub</b>
            <small>企业智能体平台</small>
          </span>
        </div>

        <div className="sb-org">
          {/* <div className="lbl">当前组织</div> */}
          <div className="row">
            <Icon name="building" className="ic" />
            <OrgSwitcher />
            {currentOrg ? (
              <span className="role">{ORG_ROLE_LABELS[currentOrg.my_role]}</span>
            ) : null}
          </div>
        </div>

        <nav className="sb-nav">
          <div className="nav-group">工作台</div>
          <NavLink to={ROUTE_PATHS.HOME} end className={navLinkClass}>
            <Icon name="home" className="ic" />
            概览
          </NavLink>
          <NavLink to={ROUTE_PATHS.ORGANIZATIONS} className={navLinkClass}>
            <Icon name="building" className="ic" />
            我的组织
          </NavLink>

          <div className="nav-group">资源构建</div>
          {orgNavDisabled ? (
            <OrgDisabledItem icon="bot" label="智能体管理" />
          ) : (
            <NavLink to={agentsPath(currentOrgId)} className={navLinkClass}>
              <Icon name="bot" className="ic" />
              智能体管理
            </NavLink>
          )}
          {orgNavDisabled ? (
            <OrgDisabledItem icon="book" label="知识库" />
          ) : (
            <NavLink to={knowledgeBasesPath(currentOrgId)} className={navLinkClass}>
              <Icon name="book" className="ic" />
              知识库
            </NavLink>
          )}
          {orgNavDisabled ? (
            <OrgDisabledItem icon="wrench" label="工具" />
          ) : (
            <NavLink to={toolsPath(currentOrgId)} className={navLinkClass}>
              <Icon name="wrench" className="ic" />
              工具
            </NavLink>
          )}
          {orgNavDisabled ? (
            <OrgDisabledItem icon="layers" label="模型供应商" />
          ) : (
            <NavLink to={modelProvidersPath(currentOrgId)} className={navLinkClass}>
              <Icon name="layers" className="ic" />
              模型供应商
            </NavLink>
          )}

          <div className="nav-group">运行与监控</div>
          {orgNavDisabled ? (
            <OrgDisabledItem icon="chat" label="AI 对话" />
          ) : (
            <NavLink to={chatPath(currentOrgId)} className={navLinkClass}>
              <Icon name="chat" className="ic" />
              AI 对话
            </NavLink>
          )}
          {/* 执行监控：viewer 不可见（与后端权限矩阵一致，execution.md D3） */}
          {orgNavDisabled ? (
            <OrgDisabledItem icon="activity" label="执行监控" />
          ) : canSeeExecutions ? (
            <NavLink to={executionsPath(currentOrgId)} className={navLinkClass}>
              <Icon name="activity" className="ic" />
              执行监控
            </NavLink>
          ) : null}
          {canManageOrganization || orgNavDisabled ? <>
            <div className="nav-group">组织管理</div>
            {orgNavDisabled ? (
              <OrgDisabledItem icon="settings" label="组织设置" />
            ) : canManageOrganization ? (
              <NavLink to={orgSettingsPath(currentOrgId!)} className={navLinkClass}>
                <Icon name="settings" className="ic" />
                组织设置
              </NavLink>
            ) : null}
            {orgNavDisabled ? (
              <OrgDisabledItem icon="users" label="成员管理" />
            ) : canManageOrganization ? (
              <NavLink to={orgMembersPath(currentOrgId!)} className={navLinkClass}>
                <Icon name="users" className="ic" />
                成员管理
              </NavLink>
            ) : null}
          </> : null}
        </nav>

        <div className="sb-foot">
          <div className="sb-user" onClick={handleOpenUserMenu}>
            <span className={`avatar md user-av user-avatar`}>
              {(me?.username ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <p className="un">{me?.username ?? '…'}</p>
              <p className="ue">{me?.email}</p>
            </span>
          </div>
        {showUserMenu && (
          <div className="sb-user-popover">
            {/* 分组1 */}
            <div className="sb-user-popover__group">
              <div className="sb-user-popover__item">
                <Icon name="circle-user" className="ic" />
                <span>个人资料</span>
                <Icon name="chevron-right" className="ic sb-user-popover__arrow" />
              </div>
              <div className="sb-user-popover__item">
                <Icon name="settings" width={16} height={16} />
                <span>设置</span>
                <span className="sb-user-popover__arrow"></span>
              </div>
            </div>

            {/* 分割横线 */}
            <div className="sb-user-popover__divider"></div>

            {/* 分组2 */}
            <div className="sb-user-popover__group">
              <div className="sb-user-popover__item" onClick={handleLogout}>
                <Icon name="logout" className="ic" />
                <span>退出登录</span>
                {/* 无箭头，不渲染箭头span */}
              </div>
            </div>
          </div>)}
     
        </div>


      </aside>

      <main className="content">
        <div className="page">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** 根据用户名稳定映射头像渐变（av-1..av-6） */
// function avatarTone(name: string): string {
//   let hash = 0
//   for (let i = 0; i < name.length; i += 1) {
//     hash = (hash * 31 + name.charCodeAt(i)) % 997
//   }
//   return `av-${(hash % 6) + 1}`
// }
