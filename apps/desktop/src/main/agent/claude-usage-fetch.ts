import { setClaudeUsageFetch, setDefaultUsageFetch } from '@superone/runtime/usage'
import { chromiumUsageFetch } from '../desktop-net-fetch'

let installed = false

/**
 * Chromium's network stack honors the macOS system HTTP proxy. Node's `fetch`
 * does not. Install once from each desktop entry that reads subscription usage.
 * Claude keeps its own client; Codex, Grok, Cursor, and OpenCode share the default.
 * A test double that omits `net` throws on access; leave global `fetch` in place then.
 */
export function installClaudeUsageFetch(): void {
  if (installed) return
  const fetchImpl = chromiumUsageFetch()
  if (!fetchImpl) return
  installed = true
  setClaudeUsageFetch(fetchImpl)
  setDefaultUsageFetch(fetchImpl)
}
