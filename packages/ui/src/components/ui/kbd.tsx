import { cn } from '../../lib/utils'

type KbdVariant = 'badge' | 'inline' | 'square'

function Kbd({
  variant = 'badge',
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & { variant?: KbdVariant }) {
  return (
    <span
      className={cn(
        'text-[10px]',
        variant === 'badge' && 'rounded bg-muted px-1 py-0.5 text-muted-foreground',
        variant === 'square' &&
          'inline-flex size-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground',
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

/** Shift+Enter / Alt+Enter, the keys `AutoResizeTextarea` turns into a newline, followed by `label`. */
function NewlineKeys({ label, mac }: { label: string; mac: boolean }) {
  return (
    <>
      <Kbd aria-label="Shift+Enter">{mac ? '⇧↵' : 'Shift+Enter'}</Kbd>
      <span>/</span>
      <Kbd aria-label={mac ? 'Option+Enter' : 'Alt+Enter'}>{mac ? '⌥↵' : 'Alt+Enter'}</Kbd>
      <span>{label}</span>
    </>
  )
}

export { Kbd, NewlineKeys }
