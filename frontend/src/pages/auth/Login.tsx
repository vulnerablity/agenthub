// pages/auth/Login.tsx
// 登录页：分屏品牌区 + 表单；成功后持久化双 Token 并回跳来源页
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { authApi } from '@/api'
import Icon from '@/components/Icon'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ROUTE_PATHS } from '@/constants/routes'
import { useAuthStore } from '@/stores/auth'
import { setTokens } from '@/utils/token'

const loginSchema = z.object({
  email: z.string().min(1, '请输入邮箱').email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
})

type LoginForm = z.infer<typeof loginSchema>

interface LoginLocationState {
  from?: string
  email?: string
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const signIn = useAuthStore((state) => state.signIn)
  const [apiError, setApiError] = useState('')

  // 注册成功跳转过来时预填邮箱
  const routeState = (location.state as LoginLocationState | null) ?? {}

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: routeState.email ?? '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setApiError('')
    try {
      const { data } = await authApi.login(values)
      setTokens(data.access_token, data.refresh_token)
      signIn()
      navigate(routeState.from ?? ROUTE_PATHS.HOME, { replace: true })
    } catch (error) {
      setApiError(errorMessage(error))
    }
  })

  return (
    <div className="login-page">
      <div className="login-wrap">
        <aside className="login-brand">
          <div className="rel">
            <div className="lb-head">
              <span className="tb-logo">
                <Icon name="spark" width={19} height={19} color="#fff" />
              </span>
              <span>AgentHub</span>
            </div>
            <p className="lb-tag">ENTERPRISE AGENT PLATFORM</p>

            <h2>
              让团队把 <em>AI Agent</em>
              <br />
              真正用起来
            </h2>
            <p className="lb-sub">
              统一管理企业智能体、知识库与工具，
              <br />
              让每一次对话都有据可依、每一次执行都可追溯。
            </p>

            <div className="lb-feats">
              <div className="lb-feat">
                <Icon name="bot" className="ic" />
                基于企业知识库的智能体问答与编排
              </div>
              <div className="lb-feat">
                <Icon name="layers" className="ic" />
                全链路执行监控与 Token 用量审计
              </div>
              <div className="lb-feat">
                <Icon name="shield" className="ic" />
                组织级权限隔离与数据安全
              </div>
            </div>

            <p className="lb-foot">AgentHub · 企业智能体平台</p>
          </div>
        </aside>

        <section className="login-form">
          <h1 className="lf-title">欢迎回来</h1>
          <p className="lf-sub">登录 AgentHub 工作台，继续管理你的智能体</p>

          <form onSubmit={onSubmit} noValidate>
            <div className="fields">
              <TextField
                label="邮箱"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                error={errors.email?.message}
                {...register('email')}
              />
              <TextField
                label="密码"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                error={errors.password?.message}
                {...register('password')}
              />
            </div>

            <div className="lf-links">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded accent-[#5b5bd6]"
                  defaultChecked
                />
                记住我
              </label>
              <a href="#" onClick={(e) => e.preventDefault()}>
                忘记密码？
              </a>
            </div>

            {apiError ? <p className="mt-3 text-sm text-red-500">{apiError}</p> : null}

            <button type="submit" disabled={isSubmitting} className="btn primary mt-5">
              {isSubmitting ? '登录中…' : '登 录'}
            </button>

            <p className="lf-foot">
              还没有账号？
              <Link to={ROUTE_PATHS.REGISTER}>立即注册</Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
