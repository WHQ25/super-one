export interface PopupGroup<T> {
  key: string
  items: T[]
  startIndex: number
}

/**
 * Bucket items into a declared group order and hand each group its offset into
 * the flat list.
 *
 * `startIndex` is the whole point: a grouped popup renders sections but has to
 * navigate as one list, so the section render and the keyboard/selection index
 * must share a single index space. Read it as "the flat position of this
 * group's first row".
 *
 * **Items whose key is missing from `order` are dropped, silently.** That is
 * intentional for a caller that enumerates every key it can produce, and a trap
 * for one that does not — a new item kind simply stops appearing. Callers with
 * an open-ended key space must include a catch-all key in `order` and map
 * unknown kinds onto it.
 */
export function groupItems<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  order: readonly string[],
): PopupGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const key of order) buckets.set(key, [])
  for (const item of items) buckets.get(getKey(item))?.push(item)

  const groups: PopupGroup<T>[] = []
  let startIndex = 0
  for (const key of order) {
    const grouped = buckets.get(key)
    if (!grouped || grouped.length === 0) continue
    groups.push({ key, items: grouped, startIndex })
    startIndex += grouped.length
  }
  return groups
}
