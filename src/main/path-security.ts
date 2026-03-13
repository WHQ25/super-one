import { realpathSync } from 'fs'
import { resolve, sep } from 'path'

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
  return allowedRoots.some((root) => real.startsWith(root + sep))
}

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

export function sanitizeGitRef(ref: string): string {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('Git ref cannot be empty')
  if (trimmed.startsWith('-')) throw new Error(`Git ref cannot start with dash: ${trimmed}`)
  if (CONTROL_CHAR_RE.test(trimmed)) throw new Error('Git ref contains control characters')
  return trimmed
}

