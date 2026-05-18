import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Btn({
  children,
  variant = 'primary',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
}) {
  const cls =
    variant === 'primary'
      ? 'bg-primary text-primary-fg hover:opacity-90'
      : 'border border-border bg-card text-fg hover:bg-accent hover:text-accent-fg'
  return (
    <button
      {...rest}
      className={
        'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
        cls
      }
    >
      {children}
    </button>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 items-center">{children}</div>
}

export function Out({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-3 text-[12px] text-muted-fg whitespace-pre-wrap break-words font-mono m-0 max-h-48 overflow-auto">
      {children}
    </pre>
  )
}
