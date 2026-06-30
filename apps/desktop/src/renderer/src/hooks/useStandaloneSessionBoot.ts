import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import { useAppStore, startProjectMirror } from '@/stores/app'
import { useAgentEvents } from './useAgentEvents'
import { useTheme } from './useTheme'
import { useHarnessTheme } from './useHarnessTheme'

export function useStandaloneSessionBoot(projectPath: string, sessionId: string): void {
  useTheme()
  useHarnessTheme()
  useAgentEvents()

  const focusProject = useChatStore((s) => s.focusProject)
  const switchSession = useChatStore((s) => s.switchSession)

  useEffect(() => {
    startProjectMirror(useChatStore)
    useAppStore.setState({ view: 'main' })
    useAppStore.getState().loadRemoteConfig()
    useAppStore.getState().loadBrandHues()

    let cancelled = false
    void (async () => {
      try {
        const startupData = await window.app.getStartupData()
        if (cancelled) return
        if (startupData.cached.claude) useChatStore.getState().setHarnessResources('claude', startupData.cached.claude)
        if (startupData.cached.codex) useChatStore.getState().setHarnessResources('codex', startupData.cached.codex)
        void useChatStore.getState().initializeHarness('claude')
        void useChatStore.getState().initializeHarness('codex')

        await useChatStore.getState().syncLiveSnapshots()
        if (cancelled) return

        await focusProject(projectPath)
        if (cancelled) return
        if (useChatStore.getState().projectSessions[projectPath]?._activeSessionId !== sessionId) {
          await switchSession(sessionId)
        }
      } catch (err) {
        console.warn('[session-boot] init failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [projectPath, sessionId, focusProject, switchSession])
}
