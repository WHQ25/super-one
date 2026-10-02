/**
 * `groupItems` moved to `@superone/shared/popup-groups` so the mobile overlays
 * share one flat index space with the desktop popups. Re-exported here to keep
 * the renderer's import sites unchanged.
 */
export { groupItems, type PopupGroup } from '@superone/shared/popup-groups'

/** `count` is left out for a section that has no rows yet (still loading, failed). */
export function PopupSectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="flex select-none items-baseline gap-1 px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground"
    >
      {/* Server titles are third-party text: one line, however long. */}
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 text-muted-foreground/60">· {count}</span> : null}
    </div>
  )
}
