/**
 * `groupItems` moved to `@superone/shared/popup-groups` so the mobile overlays
 * share one flat index space with the desktop popups. Re-exported here to keep
 * the renderer's import sites unchanged.
 */
export { groupItems, type PopupGroup } from '@superone/shared/popup-groups'

export function PopupSectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="flex select-none items-baseline gap-1 px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground"
    >
      <span>{label}</span>
      <span className="text-muted-foreground/60">· {count}</span>
    </div>
  )
}
