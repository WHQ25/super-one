import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Icon + label of a `.mention-chip`. The label wraps like prose, so the icon is
 * glued to the label's first character: otherwise a line break can land right
 * after the icon and leave it stranded at the end of the previous line.
 * `iconProps` land on the icon box, e.g. to make only the icon a drag handle.
 */
export function MentionChipBody({ icon, label, iconProps }: {
  icon: ReactNode
  label: string
  iconProps?: ComponentPropsWithoutRef<'span'>
}) {
  const [first = '', ...rest] = Array.from(label)
  return (
    <span className="mention-chip__label">
      <span className="mention-chip__lead">
        <span aria-hidden {...iconProps} className={cn('mention-chip__icon', iconProps?.className)}>{icon}</span>
        {first}
      </span>
      {rest.join('')}
    </span>
  )
}
