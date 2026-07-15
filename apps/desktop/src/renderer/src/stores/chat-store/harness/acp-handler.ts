import type { AcpResources } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

export function applyAcpResources(
  s: ChatStore,
  r: AcpResources,
): Partial<ChatStore> {
  return {
    harnessResources: { ...s.harnessResources, acp: r },
  }
}

const FALLBACK_ACP_RESOURCES: AcpResources = {
  agents: [
    { id: 'grok-build', name: 'Grok Build', installed: false, commandPreview: 'grok agent stdio' },
    { id: 'opencode', name: 'OpenCode', installed: false, commandPreview: 'opencode acp' },
  ],
  selectedAgentId: null,
}

/** Read-only: main process detects on app open and writes harness_resource_cache. */
export async function connectAcpResources(): Promise<AcpResources> {
  try {
    const startup = await window.app.getStartupData()
    if (startup.cached.acp?.agents?.length) return startup.cached.acp
  } catch {
    /* fall through */
  }
  try {
    if (typeof window.app.listAcpAgents === 'function') {
      return await window.app.listAcpAgents()
    }
  } catch (err) {
    console.warn('[acp] listAcpAgents failed:', err)
  }
  return FALLBACK_ACP_RESOURCES
}
