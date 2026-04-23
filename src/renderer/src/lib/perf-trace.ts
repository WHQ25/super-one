import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'

interface ChromePerfMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

type PerfAwarePerformance = Performance & { memory?: ChromePerfMemory }

const MB = 1024 * 1024

export function perfEvent(tag: string, data?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return
  window.app.trace?.('perf.event', tag, data ?? {}, tag)
}

export function perfSample(): void {
  if (!import.meta.env.DEV) return
  const memory = (performance as PerfAwarePerformance).memory
  const chat = useChatStore.getState()
  const app = useAppStore.getState()
  const miniapp = useMiniAppStore.getState()

  let sessionsTotal = 0
  let messagesTotal = 0
  let toolBlocksTotal = 0
  for (const project of Object.values(chat.projectSessions)) {
    const sessions = Object.values(project._sessions)
    sessionsTotal += sessions.length
    for (const session of sessions) {
      messagesTotal += session.messages.length
      for (const msg of session.messages) {
        toolBlocksTotal += msg.content.length
      }
    }
  }

  window.app.trace?.('perf.renderer.sample', 'sample', {
    mem: memory ? {
      usedMB: +(memory.usedJSHeapSize / MB).toFixed(1),
      totalMB: +(memory.totalJSHeapSize / MB).toFixed(1),
      limitMB: +(memory.jsHeapSizeLimit / MB).toFixed(1),
    } : null,
    dom: { nodes: document.getElementsByTagName('*').length },
    chat: {
      projects: Object.keys(chat.projectSessions).length,
      sessionsTotal,
      messagesTotal,
      toolBlocksTotal,
      activeProject: chat.activeProject,
    },
    app: { view: app.view, layoutMode: app.layoutMode },
    miniapp: { apps: miniapp.apps.length },
  })
}

export async function perfSnapshot(tag: string): Promise<void> {
  if (!import.meta.env.DEV) return
  const api = (performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<unknown>
  }).measureUserAgentSpecificMemory
  if (!api) return
  try {
    const result = await api.call(performance)
    window.app.trace?.('perf.renderer.snapshot', tag, result as Record<string, unknown>, tag)
  } catch (err) {
    console.warn('[perf] snapshot failed:', err)
  }
}
