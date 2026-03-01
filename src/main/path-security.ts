import { realpathSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

export function resolveRealPath(inputPath: string): string {
  const absPath = resolve(inputPath)
  try {
    return realpathSync(absPath)
  } catch {
    return absPath
  }
}

export function isPathWithinAllowed(filePath: string, allowedRoots: string[]): boolean {
  const real = resolveRealPath(filePath)
  return allowedRoots.some((root) => real.startsWith(root + '/'))
}

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

export function sanitizeGitRef(ref: string): string {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('Git ref cannot be empty')
  if (trimmed.startsWith('-')) throw new Error(`Git ref cannot start with dash: ${trimmed}`)
  if (CONTROL_CHAR_RE.test(trimmed)) throw new Error('Git ref contains control characters')
  return trimmed
}

export function isValidBashOutputPath(filePath: string): boolean {
  if (filePath.includes('..')) return false
  if (!filePath.endsWith('.output')) return false
  const resolved = resolve(filePath)
  try {
    if (realpathSync(resolved) !== resolved) return false
  } catch {
    // file doesn't exist yet — no symlink concern
  }
  return resolved.startsWith(resolve(tmpdir()) + '/')
}
