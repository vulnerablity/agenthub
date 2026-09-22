// router/index.tsx
// 全应用路由表：公开页（登录/注册）与受保护区域（AppLayout 内业务页）
import { createBrowserRouter } from 'react-router-dom'

import AppLayout from '@/components/layout/AppLayout'
import { ROUTE_PATHS } from '@/constants/routes'
import Home from '@/pages/Home'
import AgentDetail from '@/pages/agents/Detail'
import AgentForm from '@/pages/agents/Form'
import AgentList from '@/pages/agents/List'
import VersionForm from '@/pages/agents/VersionForm'
import Chat from '@/pages/chat/Chat'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import OrganizationList from '@/pages/organizations/List'
import Members from '@/pages/organizations/Members'
import Settings from '@/pages/organizations/Settings'
import KnowledgeBaseList from '@/pages/knowledge/List'
import KnowledgeBaseForm from '@/pages/knowledge/Form'
import KnowledgeBaseDetail from '@/pages/knowledge/Detail'
import ToolList from '@/pages/tools/List'
import ToolForm from '@/pages/tools/Form'
import ToolDetail from '@/pages/tools/Detail'
import RequireAuth from './RequireAuth'

export const router = createBrowserRouter([
  { path: ROUTE_PATHS.LOGIN, element: <Login /> },
  { path: ROUTE_PATHS.REGISTER, element: <Register /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTE_PATHS.HOME, element: <Home /> },
          { path: ROUTE_PATHS.ORGANIZATIONS, element: <OrganizationList /> },
          { path: ROUTE_PATHS.ORG_MEMBERS, element: <Members /> },
          { path: ROUTE_PATHS.ORG_SETTINGS, element: <Settings /> },
          { path: ROUTE_PATHS.AGENTS, element: <AgentList /> },
          // /agents/new 必须声明在 /agents/:agentId 之前（保持与后端 members/me 一致的路由顺序约束）
          { path: ROUTE_PATHS.AGENT_NEW, element: <AgentForm /> },
          { path: ROUTE_PATHS.AGENT_DETAIL, element: <AgentDetail /> },
          { path: ROUTE_PATHS.AGENT_EDIT, element: <AgentForm /> },
          { path: ROUTE_PATHS.AGENT_VERSION_NEW, element: <VersionForm /> },
          { path: ROUTE_PATHS.CHAT, element: <Chat /> },
          { path: ROUTE_PATHS.CHAT_CONVERSATION, element: <Chat /> },
          { path: ROUTE_PATHS.KNOWLEDGE_BASES, element: <KnowledgeBaseList /> },
          // /knowledge-bases/new 必须声明在 /knowledge-bases/:kbId 之前（保持既有路由顺序约束）
          { path: ROUTE_PATHS.KNOWLEDGE_BASE_NEW, element: <KnowledgeBaseForm /> },
          { path: ROUTE_PATHS.KNOWLEDGE_BASE_DETAIL, element: <KnowledgeBaseDetail /> },
          { path: ROUTE_PATHS.KNOWLEDGE_BASE_EDIT, element: <KnowledgeBaseForm /> },
          { path: ROUTE_PATHS.TOOLS, element: <ToolList /> },
          // /tools/new 必须声明在 /tools/:toolId 之前（保持既有路由顺序约束）
          { path: ROUTE_PATHS.TOOL_NEW, element: <ToolForm /> },
          { path: ROUTE_PATHS.TOOL_DETAIL, element: <ToolDetail /> },
          { path: ROUTE_PATHS.TOOL_EDIT, element: <ToolForm /> },
        ],
      },
    ],
  },
])