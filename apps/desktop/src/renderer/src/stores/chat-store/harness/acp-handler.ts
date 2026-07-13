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

export async function connectAcpResources(): Promise<AcpResources> {
  try {
    if (typeof window.app.listAcpAgents === 'function') {
      return await window.app.listAcpAgents()
    }
  } catch (err) {
    console.warn('[acp] listAcpAgents failed:', err)
  }
  try {
    const startup = await window.app.getStartupData()
    if (startup.cached.acp) return startup.cached.acp
  } catch {
    /* fall through */
  }
  return {
    agents: [
      { id: 'grok-build', name: 'Grok Build', installed: false, commandPreview: 'grok agent stdio' },
      { id: 'gemini-cli', name: 'Gemini CLI', installed: false, commandPreview: 'gemini --acp' },
      { id: 'opencode', name: 'OpenCode', installed: false, commandPreview: 'opencode acp' },
    ],
    selectedAgentId: null,
  }
}
