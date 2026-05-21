export interface PopupGroup<T> {
  key: string
  items: T[]
  startIndex: number
}

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

export function PopupSectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="flex select-none items-baseline gap-1 px-2 pb-0.5 pt-2 text-[10px] font-medium text-muted-foreground"
    >
      <span>{label}</span>
      <span className="text-muted-foreground/60">· {count}</span>
    </div>
  )
}
