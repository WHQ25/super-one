import { projectRpc, type ProjectRpcClient } from './project-rpc'

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

export async function loadMcpIcons(client: ProjectRpcClient, projectPath?: string): Promise<void> {
  try {
    const reply = await (projectPath ? projectRpc(client, projectPath, 'mcp.icons') : client.rpc('mcp.icons')) as {
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
