/**
 * Browser-safe agent transcript path helpers (no Node builtins).
 *
 * Used by the desktop renderer to decide whether a remote absolute path should
 * be routed through workspace.tailWatch absolutePath. Server-side enforcement
 * lives in @superone/runtime/fs (realpath + host roots).
 */

/**
 * Client-side shape check: absolute path looks like a Grok/Claude agent transcript.
 * Does not use local homedir — remote nodes may have a different home.
 */
export function isAgentTranscriptAbsolutePath(filePath: string): boolean {
  if (!filePath || filePath.includes('\0')) return false
  const norm = filePath.replace(/\\/g, '/')
  if (!norm.startsWith('/') && !/^[A-Za-z]:\//.test(norm)) return false
  return (
    norm.includes('/.grok/sessions/')
    || norm.includes('/.claude/projects/')
    || /\/\.grok\/sessions\/?$/.test(norm)
    || /\/\.claude\/projects\/?$/.test(norm)
  )
}
