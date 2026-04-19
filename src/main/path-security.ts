import { realpathSync } from 'fs'
import { homedir } from 'os'
import { join, resolve, sep } from 'path'

function normalizeSep(p: string): string {
  return sep === '\\' ? p.replace(/\//g, '\\') : p
}

export function resolveRealPath(inputPath: string): string {
  const absPath = resolve(inputPath)
  try {
    return realpathSync(absPath)
  } catch {
    return absPath
  }
}

export function isPathWithinAllowed(filePath: string, allowedRoots: string[]): boolean {
  const real = normalizeSep(resolveRealPath(filePath))
  return allowedRoots.some((root) => real.startsWith(normalizeSep(root) + sep))
}

export function getReadableAssetRoots(
  projectRoots: string[],
  opts?: { homeDir?: string; tmpDir?: string },
): string[] {
  const homeDir = opts?.homeDir ?? homedir()
  const tmpDirs = [opts?.tmpDir ?? process.env.TMPDIR, '/tmp', '/private/tmp'].filter(Boolean) as string[]
  const extraRoots = [
    join(homeDir, '.codex', '.tmp', 'plugins'),
    join(homeDir, '.codex', '.tmp', 'bundled-marketplaces'),
  ]
  return Array.from(new Set([...projectRoots, ...tmpDirs, ...extraRoots]))
}

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

export function sanitizeGitRef(ref: string): string {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('Git ref cannot be empty')
  if (trimmed.startsWith('-')) throw new Error(`Git ref cannot start with dash: ${trimmed}`)
  if (CONTROL_CHAR_RE.test(trimmed)) throw new Error('Git ref contains control characters')
  return trimmed
}
