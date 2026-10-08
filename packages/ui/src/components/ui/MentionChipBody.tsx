import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ReactNode } from 'react'
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

/**
 * Shared shell for every chat chip (mentions, attachments, pasted text),
 * composer + bubble, desktop + phone: `[icon] [label]` in the blended style, no fill.
 * Bubble: parent .user-text-with-mentions is normal inline flow.
 * Composer: .mention-chip uses vertical-align: baseline in the paragraph.
 * Remaining props and `ref` land on the outer span, so a file chip can take its
 * click and Radix `asChild` context-menu trigger; `iconProps` make the icon its drag handle.
 */
export function MentionChipContent({
  kind,
  icon,
  label,
  iconProps,
  className,
  ...rest
}: Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  kind?: string
  icon: ReactNode
  label: string
  iconProps?: ComponentPropsWithoutRef<'span'>
}) {
  return (
    <span
      {...rest}
      data-mention-kind={kind}
      data-selection-fill=""
      className={cn('mention-chip mention-chip--blended select-none', className)}
    >
      <MentionChipBody icon={icon} label={label} iconProps={iconProps} />
    </span>
  )
}
