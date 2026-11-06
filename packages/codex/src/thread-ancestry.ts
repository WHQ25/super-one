import type { McpAppsRequest } from './mcp-apps'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Validate the provider's ancestry without resuming or altering a running child thread. */
export async function isCodexDescendantThread(request: McpAppsRequest, root: string, candidate: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000)
  const seen = new Set<string>()
  while (candidate !== root) {
    if (seen.has(candidate) || seen.size >= 32) return false
    seen.add(candidate)
    if (options.signal?.aborted) throw new Error('Codex approval ancestry check cancelled')
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Codex approval ancestry check cancelled'))
      options.signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => reject(new Error('Codex approval ancestry check timed out')), Math.max(0, deadline - Date.now()))
    })
    let thread: Record<string, unknown>
    try { thread = record((await Promise.race([request('thread/read', { threadId: candidate, includeTurns: false }), stopped])).thread) }
    finally { clearTimeout(timer); if (onAbort) options.signal?.removeEventListener('abort', onAbort) }
    const spawn = record(record(record(thread.source).subAgent).thread_spawn)
    const parent = spawn.parent_thread_id ?? thread.forkedFromId ?? thread.forked_from_id
    if (typeof parent !== 'string' || !parent) return false
    candidate = parent
  }
  return true
}
