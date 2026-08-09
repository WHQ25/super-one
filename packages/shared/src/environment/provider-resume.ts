/**
 * Node harness resume tokens use a stable prefix so SessionRuntime can
 * distinguish Claude / Codex / ACP / OpenCode ids. Desktop UI copy and local
 * sessions store the bare harness session id — strip the prefix when exposing
 * `providerSessionId` for sidebar "Copy Session ID" parity.
 */

const RESUME_PREFIXES = [
  'claude-session:',
  'thread:',
  'acp-session:',
  'opencode:',
] as const

/**
 * Extract the bare harness session/thread id from a node `providerResume`
 * token (e.g. `claude-session:abc` → `abc`). Returns null when empty.
 * Unknown bare tokens are returned as-is (simulated runners use `resume-…`).
 */
export function providerSessionIdFromResume(
  providerResume: string | null | undefined,
): string | null {
  const raw = typeof providerResume === 'string' ? providerResume.trim() : ''
  if (!raw) return null
  for (const prefix of RESUME_PREFIXES) {
    if (raw.startsWith(prefix)) {
      const id = raw.slice(prefix.length).trim()
      return id.length > 0 ? id : null
    }
  }
  return raw
}
