import type { ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { SchemaFormChoiceMark } from './SchemaFormChoiceMark'

/** A list's shortcut numbers, and the digits typed toward one so far. */
export interface ChoiceNumbers {
  count: number
  typed: string
}

/**
 * One borderless choice: its shortcut number first, the selection mark last.
 * While digits are being typed, every number they could still become lights up
 * and the exact one is marked as the pick Enter or the pause would make.
 */
export function SchemaFormChoiceRow({ index, numbers, multiple, checked, onSelect, media, trailing, children }: {
  index: number
  /** Omitted for a row that cannot be picked by its number. */
  numbers?: ChoiceNumbers
  multiple: boolean
  /** Undefined for a row that is not a choice (an implicit selection's item). */
  checked?: boolean
  onSelect?: () => void
  media?: ReactNode
  /** Actions beside the choice, outside its button. */
  trailing?: ReactNode
  children: ReactNode
}) {
  const number = String(index + 1)
  const typed = numbers?.typed ?? ''
  const exact = typed !== '' && typed === number
  const choice = checked !== undefined
  return (
    <div
      data-choice={index}
      className={cn(
        'flex items-center gap-1 rounded-md transition-colors',
        checked ? 'bg-primary/10' : exact ? 'bg-accent' : choice && 'hover:bg-accent',
      )}
    >
      <button
        type="button"
        disabled={!choice}
        role={choice ? (multiple ? 'checkbox' : 'radio') : undefined}
        aria-checked={choice ? checked : undefined}
        aria-keyshortcuts={numbers ? number : undefined}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          choice && 'cursor-pointer',
        )}
      >
        {numbers && (
          <span
            aria-hidden
            className={cn(
              'inline-flex h-4 shrink-0 items-center justify-center rounded px-1 font-mono text-[10px] tabular-nums transition-colors',
              numbers.count > 9 ? 'min-w-6' : 'min-w-4',
              typed && number.startsWith(typed) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {number}
          </span>
        )}
        {media}
        <span className="min-w-0 flex-1">{children}</span>
        {choice && <SchemaFormChoiceMark multiple={multiple} checked={checked} />}
      </button>
      {trailing}
    </div>
  )
}
