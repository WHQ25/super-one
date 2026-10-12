/** Keep the current effort when the model offers it, else medium, else the model's first level. */
export function effortForLevels<T extends string>(levels: readonly T[] | undefined, current: string | null | undefined): T | undefined {
  if (!levels?.length) return undefined
  if (current && levels.includes(current as T)) return current as T
  return levels.includes('medium' as T) ? ('medium' as T) : levels[0]
}
