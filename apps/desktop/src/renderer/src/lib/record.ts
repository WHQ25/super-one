/**
 * A copy of `record` without `key`, or `record` itself when the key was not there.
 *
 * The identity guarantee is the point: zustand reducers use this to drop an entry,
 * and returning the same object for a no-op keeps subscribers from re-rendering
 * over a removal that never happened.
 */
export function withoutKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
