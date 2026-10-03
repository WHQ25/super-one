import { Check } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/** The selection at a row's end: a checkbox for multiple choice, a check on the chosen single option. */
export function SchemaFormChoiceMark({ multiple, checked, className }: { multiple: boolean; checked: boolean; className?: string }) {
  if (!multiple) {
    return <Check aria-hidden className={cn('size-3.5 shrink-0 text-primary', !checked && 'invisible', className)} />
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
        className,
      )}
    >
      {checked && <Check className="size-2.5" />}
    </span>
  )
}
