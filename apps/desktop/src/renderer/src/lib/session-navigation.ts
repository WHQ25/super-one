import type { SessionRef } from '@superone/shared/environment/refs'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves } from '@/components/mosaic/mosaic-tree'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { LayoutControlError } from '@superone/shared/layout-control'

export function assertLayoutEnvironmentEnabled(projectPath: string): void {
  if (parseRemoteProjectKey(projectPath) && useAppStore.getState().experimentalRemoteNodesEnabled === false) {
    throw new LayoutControlError('unavailable', 'Remote nodes are disabled. Enable Remote Nodes in Settings before arranging a node session.')
  }
}

let generation = 0
function selection() {
  const chat = useChatStore.getState()
  return JSON.stringify([chat.activeProject, chat.activeProject ? chat.projectSessions[chat.activeProject]?._activeSessionId : null])
}

/** A user may move away and back while preparation awaits I/O; remember the transition. */
export function watchSessionNavigation(signal?: AbortSignal) {
  const request = ++generation
  const source = selection()
  const view = useAppStore.getState().view
  const mosaic = useMosaicStore.getState()
  let changed = false
  let committing = false
  let expected: string | undefined
  let reached = false
  const changedMosaic = () => {
    const next = useMosaicStore.getState()
    return next.mode !== mosaic.mode || next.root !== mosaic.root || next.focusedTileId !== mosaic.focusedTileId || next.lastLayout !== mosaic.lastLayout
  }
  const check = () => {
    const nextView = useAppStore.getState().view
    if ((!committing && selection() !== source) || (nextView !== view && !(committing && nextView === 'main')) || changedMosaic()) changed = true
    if (committing && expected) {
      const current = selection()
      if (current === expected) reached = true
      else if (reached) changed = true
      else if (current !== source) {
        const [sourceProject] = JSON.parse(source)
        const [expectedProject] = JSON.parse(expected)
        const [currentProject] = JSON.parse(current)
        if (sourceProject === expectedProject || currentProject !== expectedProject) changed = true
      }
    }
  }
  const unsubs = [useChatStore.subscribe?.(check), useAppStore.subscribe?.(check), useMosaicStore.subscribe?.(check)]
  return { stale: () => {
    check()
    return request !== generation || !!signal?.aborted || changed
  },
    beginCommit: (target?: { projectPath: string; sessionId: string }) => {
      committing = true
      expected = target ? JSON.stringify([target.projectPath, target.sessionId]) : undefined
    },
    dispose: () => unsubs.forEach(unsub => unsub?.()) }
}

/** Shared by links and layout control. Preparation never moves the UI. */
export async function navigateToSession(ref: SessionRef, options: { signal?: AbortSignal; navigation?: ReturnType<typeof watchSessionNavigation> } = {}) {
  const source = selection()
  const navigation = options.navigation ?? watchSessionNavigation(options.signal)
  const stale = navigation.stale
  let prepared: { projectPath: string; sessionId: string } | null = null
  try {
    const target = await window.environment.sessionLinkTarget(ref)
    assertLayoutEnvironmentEnabled(target.projectPath)
    if (target.ref.environmentId !== ref.environmentId || target.ref.sessionId !== ref.sessionId) throw new Error('Session target mismatch')
    if (stale()) return { status: 'superseded' as const, target }
    const active = JSON.stringify([target.projectPath, ref.sessionId]) === source
    if (!active && !await window.environment.getSession(target.connectionId ?? 'local', ref.sessionId)) throw new Error('Session could not be restored')
    if (stale()) return { status: 'superseded' as const, target }
    assertLayoutEnvironmentEnabled(target.projectPath)
    const mosaic = useMosaicStore.getState()
    if (mosaic.mode === 'mosaic') {
      if (!useChatStore.getState().mountedSessions[target.projectPath]?.includes(ref.sessionId)) prepared = { projectPath: target.projectPath, sessionId: ref.sessionId }
      await useChatStore.getState().mountSession(target.projectPath, ref.sessionId)
      if (stale()) return { status: 'superseded' as const, target }
    }
    if (stale()) return { status: 'superseded' as const, target }
    navigation.beginCommit({ projectPath: target.projectPath, sessionId: ref.sessionId })
    const expected = JSON.stringify([target.projectPath, ref.sessionId])
    try {
      if (!active) await useChatStore.getState().switchToSession(target.projectPath, ref.sessionId)
    } catch (error) {
      const [sourceProject, sourceSession] = JSON.parse(source) as [string | null, string | null]
      if (!stale() && selection() === expected && sourceProject && sourceSession) {
        await useChatStore.getState().switchToSession(sourceProject, sourceSession)
      }
      throw error
    }
    if (stale() || selection() !== expected) return { status: 'superseded' as const, target }
    useMosaicStore.getState().focusOrReplaceFocused(target.projectPath, ref.sessionId, { navigate: false })
    useAppStore.getState().navigateTo('main')
    return { status: 'applied' as const, target }
  } finally {
    navigation.dispose()
    if (prepared) {
      const root = useMosaicStore.getState().root
      if (!root || !collectLeaves(root).some(t => t.projectPath === prepared!.projectPath && t.sessionId === prepared!.sessionId)) {
        useChatStore.getState().unmountSession(prepared.projectPath, prepared.sessionId)
      }
    }
  }
}
