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
        variant === 'badge' && 'rounded bg-background/60 px-1 py-0.5 text-muted-foreground',
        variant === 'square' &&
          'inline-flex size-4 shrink-0 items-center justify-center rounded bg-background/60 text-muted-foreground',
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export { Kbd }
