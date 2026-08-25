import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import { useAppStore, startProjectMirror } from '@/stores/app'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
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
        if (startupData.cached.opencode) useChatStore.getState().setHarnessResources('opencode', startupData.cached.opencode)
        if (startupData.cached.cursor) useChatStore.getState().setHarnessResources('cursor', startupData.cached.cursor)
        void useChatStore.getState().initializeHarness('claude')
        void useChatStore.getState().initializeHarness('codex')

        await useChatStore.getState().syncLiveSnapshots()
        if (cancelled) return

        // Remote mini window: must bind host connection + projectId (not only focusProject).
        const remote = parseRemoteProjectKey(projectPath)
        if (remote) {
          await useAppStore.getState().selectProject(projectPath, {
            connectionId: remote.connectionId,
          })
        } else {
          await focusProject(projectPath)
        }
        if (cancelled) return
        if (useChatStore.getState().projectSessions[projectPath]?._activeSessionId !== sessionId) {
          await switchSession(sessionId)
        }
        if (cancelled) return
        // Sessions restored from a live snapshot are flagged `_historyHydrated` without
        // ever loading the persisted title, which would leave this window titled after
        // the first user message. mountSession owns that DB back-fill.
        await useChatStore.getState().mountSession(projectPath, sessionId)
      } catch (err) {
        console.warn('[session-boot] init failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [projectPath, sessionId, focusProject, switchSession])
}
