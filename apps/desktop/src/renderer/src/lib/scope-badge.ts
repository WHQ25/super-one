export type ScopeTone = 'brand' | 'user' | 'project' | 'minor'

const SCOPE_TONE_CLASS: Record<ScopeTone, string> = {
  brand: 'bg-primary/10 text-primary',
  user: 'bg-secondary text-secondary-foreground',
  project: 'bg-accent text-accent-foreground',
  minor: 'bg-muted text-muted-foreground',
}

export function scopeBadgeClass(tone: ScopeTone): string {
  return SCOPE_TONE_CLASS[tone]
}
