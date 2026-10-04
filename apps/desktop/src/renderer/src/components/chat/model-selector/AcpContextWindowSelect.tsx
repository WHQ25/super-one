import type { SelectorCatalogParam } from './GroupedModelEffortSelector'

function formatContextWindowChoice(size: number): string {
  if (size >= 1_000_000) {
    const millions = size / 1_000_000
    const rounded = Number.isInteger(millions) ? String(millions) : millions.toFixed(1).replace(/\.0$/, '')
    return `${rounded}M`
  }
  if (size >= 1_000 && size % 1_000 === 0) return `${size / 1_000}K`
  return size.toLocaleString('en-US')
}

/**
 * Context rows for the model menu, same slot as Cursor's context parameter.
 * Hidden unless the model lists more than one positive window.
 * The checked row is the user's pick, else the model's current window when
 * that size is listed, else the first listed size. Clicking the checked row
 * sends nothing.
 */
export function acpContextWindowParam(
  windows: number[] | undefined,
  selected: number | null,
  current: number | null,
  label: string,
): SelectorCatalogParam | null {
  const listed = (windows ?? []).filter((size) => Number.isFinite(size) && size > 0)
  if (listed.length <= 1) return null
  const picked = selected != null && listed.includes(selected)
    ? selected
    : current != null && listed.includes(current)
      ? current
      : listed[0]!
  return {
    id: 'context',
    label,
    kind: 'choice',
    values: listed.map((size) => ({ value: String(size), label: formatContextWindowChoice(size) })),
    selected: String(picked),
  }
}
