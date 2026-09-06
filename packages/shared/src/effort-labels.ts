/**
 * One spelling and one ordering for reasoning effort, shared by the desktop
 * selectors, the Remote Control host projection and the mobile picker. Every
 * surface used to carry its own copy, which is how `xhigh` ended up as both
 * "Extra High" and "Xhigh" depending on where you looked.
 */

const EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
  ultra: 'Ultra',
}

/**
 * Agents often emit effort options high→low; every SuperOne effort control runs
 * left→right ascending. Unknown ids keep their relative order, after the known ones.
 */
const EFFORT_ASC_RANK: Record<string, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
}

export function formatEffortLabel(value: string): string {
  const key = value.trim().toLowerCase()
  return EFFORT_LABELS[key]
    ?? value
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
}

/** `"High Effort"` → `"High"`. Agent-supplied names repeat the noun the UI already shows. */
export function compactEffortLabel(name: string): string {
  return name.replace(/\s+Effort$/i, '').trim() || name
}

/** Agent-supplied option name → display label: `"High Effort"` → `"High"`, `"xhigh"` → `"Extra High"`. */
export function formatEffortOptionLabel(name: string): string {
  return formatEffortLabel(compactEffortLabel(name))
}

/** True when the id (or the effort word inside a name) is a known level. */
export function isKnownEffortLevel(value: string): boolean {
  return value.trim().toLowerCase() in EFFORT_ASC_RANK
}

function rankKey(id: string, name: string): string {
  const fromId = id.trim().toLowerCase()
  if (fromId in EFFORT_ASC_RANK) return fromId
  return name.trim().toLowerCase().replace(/\s+effort$/, '')
}

/** Sort effort-like options ascending (low → high) for slider and list UIs. */
export function sortEffortsAscending<T extends { value: string; label?: string }>(options: T[]): T[] {
  return options
    .map((option, index) => ({ option, index, rank: EFFORT_ASC_RANK[rankKey(option.value, option.label ?? '')] }))
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank
      if (a.rank != null) return -1
      if (b.rank != null) return 1
      return a.index - b.index
    })
    .map(({ option }) => option)
}
