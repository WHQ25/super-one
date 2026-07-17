/**
 * Safe environment helpers for child-process spawns.
 *
 * Two macOS / `execve` failure modes are guarded here:
 *
 *   - `ENAMETOOLONG` (errno 63): a single PATH component longer than
 *     PATH_MAX (1024 bytes on macOS) makes `execvp` build a pathname that is
 *     too long and fail the WHOLE spawn — even though the rest of the env is
 *     fine. This is what the `fixPath` warning in `agent/resolve-cli.ts`
 *     anticipates ("may trigger spawn ENAMETOOLONG on macOS").
 *
 *   - `E2BIG` (errno 7): the combined argv + envp exceeds the kernel limit
 *     (historically 256 KB on macOS). Note: an *oversized* env yields E2BIG,
 *     not ENAMETOOLONG — but both are fixed by sanitizing the env before
 *     handing it to `spawn` / `execFile`.
 *
 * Keep this module dependency-free (no electron / app logger) so it is safe to
 * import from anywhere, including tests.
 */

/** macOS / BSD PATH_MAX. */
export const SPAWN_PATH_MAX = 1024

/**
 * macOS / BSD NAME_MAX — the max length of a *single* path component
 * (one directory/file name). A PATH entry whose any component exceeds this can
 * never be created on the filesystem and makes `execve` return ENAMETOOLONG
 * for the whole spawn — even when the full entry is well under PATH_MAX.
 */
export const SPAWN_NAME_MAX = 255

/** Hard ceiling for the serialized argv+envp (bytes). Stays under every macOS ARG_MAX variant. */
export const MAX_ENV_BYTES = 256 * 1024

const ESSENTIAL_EXACT = new Set<string>([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'LC_CTYPE', 'DISPLAY', 'TMPDIR', 'TEMP', 'TMP',
  'DYLD_FRAMEWORK_PATH', 'DYLD_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
])

const ESSENTIAL_PREFIXES = [
  'LC_', 'ELECTRON_', 'ANTHROPIC_', 'CODEX_', 'NPM_CONFIG_', 'NODE_',
  'SSH_', 'GIT_',
]

function isEssentialEnv(key: string): boolean {
  if (ESSENTIAL_EXACT.has(key)) return true
  return ESSENTIAL_PREFIXES.some((p) => key.startsWith(p))
}

export interface SanitizePathResult {
  value: string
  dropped: number
  deduped: number
  /** Dropped because the whole entry exceeded PATH_MAX. */
  droppedByPathMax: number
  /** Dropped because a single directory-name component exceeded NAME_MAX. */
  droppedByNameMax: number
}

/**
 * Deduplicate and drop PATH components that are individually too long to resolve.
 *
 * A PATH entry is dropped if:
 *  - its full length exceeds PATH_MAX (execvp would build `entry/cmd` > PATH_MAX), or
 *  - any single `/`-separated component exceeds NAME_MAX (that name can never
 *    exist on disk and makes `execve` return ENAMETOOLONG for the entire spawn).
 */
export function sanitizePathEnv(pathEnv: string): SanitizePathResult {
  const seen = new Set<string>()
  const out: string[] = []
  let dropped = 0
  let deduped = 0
  let droppedByPathMax = 0
  let droppedByNameMax = 0
  for (const entry of pathEnv.split(':')) {
    if (!entry) continue
    if (seen.has(entry)) {
      deduped++
      continue
    }
    seen.add(entry)
    if (entry.length > SPAWN_PATH_MAX) {
      dropped++
      droppedByPathMax++
      continue
    }
    if (entry.split('/').some((comp) => Buffer.byteLength(comp, 'utf8') > SPAWN_NAME_MAX)) {
      dropped++
      droppedByNameMax++
      continue
    }
    out.push(entry)
  }
  return { value: out.join(':'), dropped, deduped, droppedByPathMax, droppedByNameMax }
}

function serializedSize(env: Record<string, string>): number {
  let n = 0
  for (const key in env) {
    n += Buffer.byteLength(key) + Buffer.byteLength(env[key]) + 2
  }
  return n
}

/**
 * Build a child-process env that is safe to pass to `spawn` / `execFile`.
 *
 *  - Merges `base` (defaults to the current `process.env`) with `extra`.
 *  - Drops `undefined` values (they would otherwise crash Node's env serializer).
 *  - Sanitizes PATH (dedupe + drop over-long components) -> avoids ENAMETOOLONG.
 *  - If the combined size still exceeds MAX_ENV_BYTES, trims the longest
 *    non-essential variables first -> avoids E2BIG.
 */
export function sanitizeEnv(
  base: NodeJS.ProcessEnv = process.env,
  extra?: NodeJS.ProcessEnv,
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const key in base) {
    const v = base[key]
    if (v !== undefined) merged[key] = v
  }
  if (extra) {
    for (const key in extra) {
      const v = extra[key]
      if (v !== undefined) merged[key] = v
    }
  }

  if (process.platform !== 'win32' && typeof merged.PATH === 'string') {
    const res = sanitizePathEnv(merged.PATH)
    merged.PATH = res.value
    if (res.dropped > 0) {
      const parts: string[] = []
      if (res.droppedByPathMax > 0)
        parts.push(`${res.droppedByPathMax} 整段 > PATH_MAX(${SPAWN_PATH_MAX}B)`)
      if (res.droppedByNameMax > 0)
        parts.push(`${res.droppedByNameMax} 段含 > NAME_MAX(${SPAWN_NAME_MAX}B) 的目录名`)
      console.warn(`[spawn-env] 为规避 spawn ENAMETOOLONG 已丢弃 ${res.dropped} 个超长 PATH 分段（${parts.join('；')}）`)
    }
  }

  let size = serializedSize(merged)
  if (size > MAX_ENV_BYTES) {
    const entries = Object.entries(merged).sort((a, b) => b[1].length - a[1].length)
    for (const [key, value] of entries) {
      if (size <= MAX_ENV_BYTES) break
      if (isEssentialEnv(key)) continue
      size -= Buffer.byteLength(key) + Buffer.byteLength(value) + 2
      delete merged[key]
    }
    if (size > MAX_ENV_BYTES) {
      console.warn(`[spawn-env] env still ${size} bytes after trimming non-essential vars (limit ${MAX_ENV_BYTES})`)
    } else {
      console.warn(`[spawn-env] trimmed env to ${size} bytes to avoid spawn E2BIG`)
    }
  }

  return merged
}

/** Convenience wrapper that always starts from the current `process.env`. */
export function buildSafeEnv(extra?: NodeJS.ProcessEnv): Record<string, string> {
  return sanitizeEnv(process.env, extra)
}
