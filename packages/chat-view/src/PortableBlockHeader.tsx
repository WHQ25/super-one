import type { ReactNode } from 'react'

/**
 * The frame of a block that stands in a reply on its own, a widget or an MCP App View: no
 * card, a small inset, and a muted header line above the content. The desktop reveals that
 * header on hover; a phone has no hover, so it is always shown, muted.
 */
export const PORTABLE_BLOCK_CLASS = 'my-2 w-full px-1'

export function PortableBlockHeader({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    // Right-aligned like the desktop's, so the block's content keeps the reply's left edge.
    <div className="mb-1 flex h-6 items-center justify-end gap-1.5 px-0.5 text-xs text-muted-foreground/70">
      {icon}
      <span className="min-w-0 truncate">{title}</span>
      {children}
    </div>
  )
}

export function PortableBlockHeaderButton({ label, expanded, onPress, children }: {
  label: string
  expanded?: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onPress}
      // Negative margin keeps the drawn glyph small while the tap target stays
      // finger-sized, the same trade the tool rows make with `hitSlop`.
      className="-m-2 shrink-0 p-2 text-muted-foreground/70"
    >
      {children}
    </button>
  )
}

/** The one action of a state, inline in a header or a tool row's trailing slot. */
export function PortableInlineAction({ label, onPress, disabled, children }: {
  label: string
  onPress: () => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className="flex shrink-0 items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-foreground disabled:opacity-50"
    >
      {children}
      {label}
    </button>
  )
}
