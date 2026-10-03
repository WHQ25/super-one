import { Check } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export function SchemaFormChoiceMark({ multiple, checked, className }: { multiple: boolean; checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-3.5 shrink-0 items-center justify-center border',
        multiple ? 'rounded-[3px]' : 'rounded-full',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
        className,
      )}
    >
      {checked && (multiple ? <Check className="size-2.5" /> : <span className="size-1.5 rounded-full bg-current" />)}
    </span>
  )
}
