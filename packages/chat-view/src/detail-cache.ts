/** Bound retained detail text, independently of the transcript window. */
const MAX_CHARS = 1_000_000
const entries = new Map<string, { text: string; complete: boolean }>()
let chars = 0
export function readDetailCache(ref: string) {
  const entry = entries.get(ref)
  if (entry) { entries.delete(ref); entries.set(ref, entry) }
  return entry
}
export function writeDetailCache(ref: string, text: string, complete: boolean): void {
  chars -= entries.get(ref)?.text.length ?? 0
  entries.delete(ref)
  if (text.length <= MAX_CHARS) { entries.set(ref, { text, complete }); chars += text.length }
  while (chars > MAX_CHARS) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    chars -= entries.get(oldest)!.text.length
    entries.delete(oldest)
  }
}
