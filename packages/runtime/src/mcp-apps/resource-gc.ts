import type { McpAppResourceStore } from '@superone/shared/mcp-app-resource'

/** Coalesce deletion sweeps; retry after the write grace without blocking startup or keeping the host alive. */
export function createMcpAppResourceGc(store: McpAppResourceStore, references: () => Iterable<string>, graceMs = 5 * 60_000) {
  let immediate: ReturnType<typeof setTimeout> | undefined
  let settled: ReturnType<typeof setTimeout> | undefined
  const sweep = () => { try { store.collect(references(), graceMs) } catch { /* Never collect if references cannot be read. */ } }
  return {
    schedule() {
      if (!immediate) { immediate = setTimeout(() => { immediate = undefined; sweep() }, 0); immediate.unref?.() }
      if (!settled) { settled = setTimeout(() => { settled = undefined; sweep() }, graceMs + 1); settled.unref?.() }
    },
    dispose() { clearTimeout(immediate); clearTimeout(settled); immediate = undefined; settled = undefined },
  }
}
