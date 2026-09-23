import type { ReactNode } from 'react'

/**
 * Icon + label of a `.mention-chip`. The label wraps like prose, so the icon is
 * glued to the label's first character: otherwise a line break can land right
 * after the icon and leave it stranded at the end of the previous line.
 */
export function MentionChipBody({ icon, label }: { icon: ReactNode; label: string }) {
  const [first = '', ...rest] = Array.from(label)
  return (
    <span className="mention-chip__label">
      <span className="mention-chip__lead">
        <span className="mention-chip__icon" aria-hidden>{icon}</span>
        {first}
      </span>
      {rest.join('')}
    </span>
  )
}
