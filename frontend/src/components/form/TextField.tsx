// components/form/TextField.tsx
// 通用文本输入：带标签、错误提示与禁用态，供登录/注册及后续表单复用
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes } from 'react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, className = '', id, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
            : 'border-neutral-300 focus:border-indigo-500 focus:ring-indigo-100'
        } ${className}`}
        {...rest}
      />
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  )
})

export default TextField