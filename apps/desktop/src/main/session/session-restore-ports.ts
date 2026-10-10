import type { DesktopRestorePorts } from './session-restore-facts'
import { loadRealtimeTimeline } from './realtime-timeline-repo'
import { whenHighlighterReady } from '../remote-highlighter'

export const desktopRestorePorts: DesktopRestorePorts = {
  prepare: async (session) => {
    await whenHighlighterReady()
    return session?.snapshot.harnessId === 'acp'
      ? import('../acp/grok-sandbox').then(m => m.currentGrokSandbox()).catch(() => undefined)
      : undefined
  },
  realtime: loadRealtimeTimeline,
}
