/**
 * Stall tinting shared by the desktop sidebar and the tool rows the phone renders.
 * The level itself is computed against desktop chat state, so only the type and the
 * pure color mapping live here — see `lib/stall-utils` for the hooks.
 */
export type StallLevel = 'normal' | 'warning' | 'critical'

export function getStallColor(level: StallLevel, normalColor = 'text-muted-foreground'): string {
  if (level === 'critical') return 'text-red-500'
  if (level === 'warning') return 'text-amber-500'
  return normalColor
}
