import type { RelayClient } from '@superone/relay-client'
import { randomId } from './ids'

let icons: Record<string, string> = {}
let revision = 0

export function mcpIconsSnapshot(): Record<string, string> {
  return icons
}

export function mcpIconsRevision(): number {
  return revision
}

export function clearMcpIconsForTests(): void {
  if (Object.keys(icons).length) revision++
  icons = {}
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

export async function loadMcpIcons(client: Pick<RelayClient, 'request'>, projectPath?: string): Promise<void> {
  try {
    const reply = await client.request({
      type: 'get_mcp_icons',
      requestId: randomId(),
      ...(projectPath ? { projectPath } : {}),
    }) as {
      icons?: Record<string, string>
      error?: string
    } | null
    if (!reply || reply.error || !reply.icons || typeof reply.icons !== 'object') return
    const next: Record<string, string> = {}
    for (const [name, src] of Object.entries(reply.icons)) {
      if (typeof name === 'string' && name && typeof src === 'string' && src) next[name] = src
    }
    if (sameMap(icons, next)) return
    icons = next
    revision++
  } catch {
    // Older hosts have no get_mcp_icons; keep the previous map (usually empty).
  }
}
