const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

/**
 * Reject flag injection and empty refs (shared by desktop path-security + CLI git).
 * Throws Error; CLI callers may wrap with `{ code: 'invalid_argument' }`.
 */
export function sanitizeGitRef(ref: string): string {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('Git ref cannot be empty')
  if (trimmed.startsWith('-')) throw new Error(`Git ref cannot start with dash: ${trimmed}`)
  if (CONTROL_CHAR_RE.test(trimmed)) throw new Error('Git ref contains control characters')
  return trimmed
}

export function gitErrorMessage(err: unknown): string {
  const stderr = (err as { stderr?: string })?.stderr?.trim()
  if (stderr) return stderr
  return (err as Error)?.message ?? 'Unknown git error'
}
