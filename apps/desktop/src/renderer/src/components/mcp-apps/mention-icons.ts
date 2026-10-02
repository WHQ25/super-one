import { create } from 'zustand'
import type { McpMentionSource } from '@superone/shared/mcp-app-mentions'

/**
 * Server icons for MCP mention chips, by server name. The chip's tag goes to the
 * model, so it carries no icon; chips look the icon up here. Search answers fill
 * it, and it survives restarts so old bubbles keep their icon without asking a
 * harness (rendering a transcript must never start one).
 */
const STORAGE_KEY = 'superone.mcpMentionIcons'
/** Icons are capped at 32 KiB each; this bounds the stored total. */
const MAX_ENTRIES = 32

function load(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
  } catch {
    // A corrupt entry only costs the icons.
    return {}
  }
}

const useMcpMentionIconStore = create<{ icons: Record<string, string> }>(() => ({ icons: load() }))

export function rememberMcpMentionIcons(sources: McpMentionSource[]): void {
  const current = useMcpMentionIconStore.getState().icons
  const changed = sources.filter(source => source.icon && current[source.server] !== source.icon)
  if (!changed.length) return
  // Newest last, so trimming drops the servers seen longest ago.
  const next = Object.entries(current).filter(([server]) => !changed.some(source => source.server === server))
  for (const source of changed) next.push([source.server, source.icon!])
  const icons = Object.fromEntries(next.slice(-MAX_ENTRIES))
  useMcpMentionIconStore.setState({ icons })
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(icons)) } catch { /* quota: memory still has it */ }
}

export function useMcpMentionIcon(server: string | undefined): string | undefined {
  return useMcpMentionIconStore(state => server ? state.icons[server] : undefined)
}
