import type { MentionItem } from '../mentions'

const artwork = new Map<string, string>()
let revision = 0
const key = (kind: string, value: string) => `${kind}:${value}`

/** Dynamic app artwork is session-local metadata. Mention serialization keeps
 * the stable app identity while this cache keeps large PNGs out of every native edit event. */
export function rememberMentionArtwork(item: MentionItem): void {
  const identity = key(item.kind, item.path)
  if (item.iconPng && artwork.get(identity) !== item.iconPng) {
    artwork.set(identity, item.iconPng)
    revision++
  }
}

export function dynamicMentionArtwork(kind: string, value: string): string | undefined {
  return artwork.get(key(kind, value))
}

export function dynamicMentionArtworkSnapshot(): Record<string, string> {
  return Object.fromEntries(artwork)
}

export function dynamicMentionArtworkRevision(): number {
  return revision
}

export function clearDynamicMentionArtworkForTests(): void {
  if (artwork.size) revision++
  artwork.clear()
}
