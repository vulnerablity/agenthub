// pages/auth/Register.tsx
// 注册页：分屏品牌区 + 表单（邮箱/用户名/密码），成功后跳登录页并预填邮箱
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'

import { authApi } from '@/api'
import Icon from '@/components/Icon'
import TextField from '@/components/form/TextField'
import { errorMessage } from '@/constants/error-messages'
import { ROUTE_PATHS } from '@/constants/routes'

// 校验规则与后端 schemas/auth.py 保持一致：密码最少 6 位、用户名 1-100
const registerSchema = z.object({
  email: z.string().min(1, '请输入邮箱').email('邮箱格式不正确'),
  username: z.string().min(1, '请输入用户名').max(100, '用户名不能超过 100 个字符'),
  password: z.string().min(6, '密码至少 6 位').max(128, '密码不能超过 128 位'),
})

type RegisterForm = z.infer<typeof registerSchema>

export default function Register() {
  const navigate = useNavigate()
  const [apiError, setApiError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', username: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setApiError('')
    try {
      await authApi.register(values)
      // 注册成功：跳登录页并携带邮箱用于预填
      navigate(ROUTE_PATHS.LOGIN, { state: { email: values.email } })
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
              从 <em>第一个智能体</em>
              <br />
              开始企业智能化
            </h2>
            <p className="lb-sub">
              创建账号后即可加入或创建组织，
              <br />
              配置知识库、工具与可对话的智能体。
            </p>

            <div className="lb-feats">
              <div className="lb-feat">
                <Icon name="users" className="ic" />
                组织协作与角色权限
              </div>
              <div className="lb-feat">
                <Icon name="db" className="ic" />
                企业知识库统一沉淀
              </div>
              <div className="lb-feat">
                <Icon name="activity" className="ic" />
                执行过程全量可追溯
              </div>
            </div>

            <p className="lb-foot">AgentHub · 企业智能体平台</p>
          </div>
        </aside>

        <section className="login-form">
          <h1 className="lf-title">创建账号</h1>
          <p className="lf-sub">注册一个新的 AgentHub 账号</p>

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
                label="用户名"
                autoComplete="username"
                placeholder="请输入用户名"
                error={errors.username?.message}
                {...register('username')}
              />
              <TextField
                label="密码"
                type="password"
                autoComplete="new-password"
                placeholder="至少 6 位"
                error={errors.password?.message}
                {...register('password')}
              />
            </div>

            {apiError ? <p className="mt-3 text-sm text-red-500">{apiError}</p> : null}

            <button type="submit" disabled={isSubmitting} className="btn primary mt-5">
              {isSubmitting ? '注册中…' : '注 册'}
            </button>

            <p className="lf-foot">
              已有账号？
              <Link to={ROUTE_PATHS.LOGIN}>去登录</Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
