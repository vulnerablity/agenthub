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
    <div className="field">
      <label htmlFor={inputId} className="lbl">
        {label}
      </label>
      <div className={`input${error ? ' err' : ''}`}>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          className={className}
          {...rest}
        />
      </div>
      {error ? <p className="err-text">{error}</p> : null}
    </div>
  )
})

export default TextField
