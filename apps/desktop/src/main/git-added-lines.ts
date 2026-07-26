import { readFile, stat } from 'fs/promises'

/**
 * Added-line count for an untracked file, memoized on (mtime, size).
 *
 * `git diff --shortstat` only covers tracked paths, so the dirty stat has to
 * read untracked files itself to count their lines. That runs on every 5s
 * status-bar poll, for every untracked path in the repo — a few thousand full
 * file reads per poll in a repo with a large untracked set. Files change far
 * more slowly than we poll, so a stat-keyed cache turns every repeat poll into
 * a stat-only pass.
 */

interface CacheEntry {
  mtimeMs: number
  size: number
  lines: number
}

/** Reading a multi-GB blob into a Buffer would stall the main process, and an added-line count that large is meaningless anyway. */
const MAX_BYTES = 4 * 1024 * 1024
/** Bound the cache so a long-lived session over many repos cannot grow it without limit. */
const MAX_ENTRIES = 5_000

const cache = new Map<string, CacheEntry>()
let reads = 0

function countLines(buf: Buffer): number {
  if (buf.includes(0)) return 0 // binary
  let count = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) count++
  }
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) count++
  return count
}

/** Returns 0 for directories, binaries, and files too large to be worth counting. */
export async function countAddedLines(absPath: string): Promise<number> {
  const st = await stat(absPath)
  if (!st.isFile()) return 0
  if (st.size > MAX_BYTES) return 0

  const hit = cache.get(absPath)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.lines

  reads++
  const lines = countLines(await readFile(absPath))
  if (cache.size >= MAX_ENTRIES) cache.clear()
  cache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, lines })
  return lines
}

/** Test seam: clears the cache and the read counter. */
export function resetAddedLinesCache(): void {
  cache.clear()
  reads = 0
}

/** Test seam: how many files were actually opened since the last reset. */
export function addedLinesReadCount(): number {
  return reads
}
