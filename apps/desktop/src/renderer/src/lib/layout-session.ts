import { LayoutControlError, type LayoutActRequest, type LayoutActResult, type LayoutControlCaller, type LayoutTarget } from '@superone/shared/layout-control'
import type { SessionRef } from '@superone/shared/environment/refs'
import { parseRemoteProjectKey, projectSessionKey, remoteProjectKey } from '@superone/shared/remote-resource-key'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves } from '@/components/mosaic/mosaic-tree'
import { isDockReady } from '@/components/activity/activity-panel-api'
import { findSessionTarget } from '@/stores/chat-store/helpers/store-helpers'
import { layoutAct } from './layout-control'
import { readLayoutSnapshot, withLayoutActionState } from './layout-action-results'
import { assertLayoutEnvironmentEnabled, navigateToSession, watchSessionNavigation } from './session-navigation'

import { MOSAIC_ACTIONS, applyMosaicAction, restorableRoot, sessionLayoutSnapshot, validateMosaicRequest } from './layout-mosaic'

async function sessionRef(projectPath: string, sessionId: string): Promise<SessionRef> {
  const environmentId = await window.environment.sessionSource(projectPath)
  if (!environmentId) throw new LayoutControlError('unavailable', 'Session environment is unavailable.')
  return { environmentId, sessionId }
}

async function targetRef(caller: LayoutControlCaller, target?: LayoutTarget): Promise<SessionRef> {
  if (target && typeof target === 'object') {
    if (!target.sessionId || !target.environmentId) throw new LayoutControlError('invalid', 'target needs environmentId and sessionId.')
    if (target.environmentId !== 'localhost') return target
    return { ...target, environmentId: (await targetRef(caller)).environmentId }
  }
  const chat = useChatStore.getState()
  if (target === 'foreground') {
    const mosaic = useMosaicStore.getState()
    const focused = mosaic.mode === 'mosaic' && mosaic.root ? collectLeaves(mosaic.root).find(leaf => leaf.id === mosaic.focusedTileId) : null
    const project = focused?.projectPath ?? chat.activeProject
    const sid = focused?.sessionId ?? (project ? chat.projectSessions[project]?._activeSessionId : null)
    if (!project || !sid) throw new LayoutControlError('unavailable', 'No foreground session. Specify a target session.')
    return sessionRef(project, sid)
  }
  if (target !== undefined && target !== 'caller') throw new LayoutControlError('invalid', 'Unknown layout target.')
  if (caller.environmentId) return { environmentId: caller.environmentId, sessionId: caller.sessionId }
  const project = findSessionTarget(chat, caller.sessionId)?.projectPath
  if (!project) throw new LayoutControlError('not_found', 'The invoking session is unavailable.')
  return sessionRef(project, caller.sessionId)
}

async function resolveTarget(caller: LayoutControlCaller, target?: LayoutTarget) {
  const ref = await targetRef(caller, target)
  const route = await window.environment.sessionLinkTarget(ref)
  assertLayoutEnvironmentEnabled(route.projectPath)
  if (route.ref.environmentId !== ref.environmentId || route.ref.sessionId !== ref.sessionId) throw new Error('Session target mismatch')
  const snap = await window.environment.getSession(route.connectionId ?? 'local', ref.sessionId) as { cwd?: string } | null
  if (!snap) throw new LayoutControlError('not_found', 'Session could not be restored.')
  const remote = parseRemoteProjectKey(route.projectPath)
  const state = useChatStore.getState().projectSessions[route.projectPath]?._sessions[ref.sessionId]
  const cwd = snap.cwd || state?._worktreePath || (remote?.path ?? route.projectPath)
  const root = remote ? remoteProjectKey(remote.connectionId, cwd) : cwd
  return { ref, context: { sessionId: ref.sessionId, projectPath: route.projectPath, key: projectSessionKey(route.projectPath, ref.sessionId), root } }
}

/** Wait for the App-owned restore, not merely for the async chat switch. */
function waitForDock(projectPath: string, sessionId: string, signal?: AbortSignal): Promise<boolean> {
  const key = projectSessionKey(projectPath, sessionId)
  return new Promise((resolve, reject) => {
    let done = false
    const subscriptions: Array<() => void> = []
    const finish = (ready: boolean, error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      subscriptions.forEach(unsubscribe => unsubscribe())
      signal?.removeEventListener('abort', check)
      if (error) reject(error)
      else resolve(ready)
    }
    const check = () => {
      const chat = useChatStore.getState()
      if (signal?.aborted || useAppStore.getState().view !== 'main' || chat.activeProject !== projectPath || chat.projectSessions[projectPath]?._activeSessionId !== sessionId || useMosaicStore.getState().mode === 'mosaic') return finish(false)
      const activity = useActivityViewStateStore.getState()
      if (isDockReady() && activity._currentSessionId === key && !activity.pendingRestore) finish(true)
    }
    const timer = setTimeout(() => finish(false, new LayoutControlError('unavailable', 'The target session opened but its activity panel did not become ready. Check layout_snapshot before retrying.')), 10_000)
    subscriptions.push(useChatStore.subscribe(check), useActivityViewStateStore.subscribe(check), useMosaicStore.subscribe(check), useAppStore.subscribe(check))
    signal?.addEventListener('abort', check, { once: true })
    check()
  })
}

export async function layoutSnapshotForTarget(caller: LayoutControlCaller, target?: LayoutTarget) {
  const resolved = await resolveTarget(caller, target)
  const layout = await sessionLayoutSnapshot()
  const snapshot = await readLayoutSnapshot(caller, resolved.context)
  snapshot.window.layout = layout.mode === 'mosaic' ? 'split' : 'single'
  if (layout.mode !== 'mosaic') delete snapshot.window.splitSessions
  return { ...snapshot, targetSession: resolved.ref, focusedSession: layout.focusedSession, visibleSessions: layout.tiles.map(tile => tile.session), layout }
}

export async function layoutActForTarget(caller: LayoutControlCaller, request: LayoutActRequest, signal?: AbortSignal): Promise<LayoutActResult> {
  const superseded = (): LayoutActResult => ({ status: 'skipped', visible: false, reason: 'superseded' })
  if (request.action === 'focus_session') {
    if (!request.target || typeof request.target !== 'object') throw new LayoutControlError('invalid', 'focus_session needs an explicit target {environmentId, sessionId}.')
    const navigation = watchSessionNavigation(signal)
    try {
      const ref = await targetRef(caller, request.target)
      if (navigation.stale()) return withLayoutActionState(caller, request, { ...superseded(), targetSession: ref, layout: await sessionLayoutSnapshot() })
      const result = await navigateToSession(ref, { signal, navigation })
      if (result.status === 'superseded') return withLayoutActionState(caller, request, { ...superseded(), targetSession: ref, layout: await sessionLayoutSnapshot() })
      if (useMosaicStore.getState().mode !== 'mosaic' && !await waitForDock(result.target.projectPath, ref.sessionId, signal)) return withLayoutActionState(caller, request, { ...superseded(), targetSession: ref, layout: await sessionLayoutSnapshot() })
      return withLayoutActionState(caller, request, { status: 'applied', visible: document.visibilityState === 'visible', targetSession: ref, layout: await sessionLayoutSnapshot() },
        { key: projectSessionKey(result.target.projectPath, ref.sessionId), projectPath: result.target.projectPath, sessionId: ref.sessionId, root: result.target.projectPath })
    } finally { navigation.dispose() }
  }
  const mosaicAction = MOSAIC_ACTIONS.has(request.action)
  if (mosaicAction) validateMosaicRequest(request)
  const navigation = mosaicAction ? watchSessionNavigation(signal) : null
  try {
    const resolved = await resolveTarget(caller, request.target)
    if (mosaicAction) {
      const ids = request.action === 'restore_splits'
        ? await Promise.all(collectLeaves(restorableRoot()).map(leaf => sessionRef(leaf.projectPath, leaf.sessionId)))
        : request.sessionIds ?? (request.sessionId ? [request.sessionId] : [])
      const peers = await Promise.all(ids.map(async id => {
        const raw = typeof id === 'string' ? { sessionId: id, environmentId: request.sessionEnvironmentId ?? resolved.ref.environmentId } : id
        if (!raw || !raw.sessionId || !raw.environmentId) throw new LayoutControlError('invalid', 'Each sessionIds entry needs a session id or {environmentId, sessionId}.')
        const peer = await resolveTarget(caller, raw)
        return { ref: peer.ref, projectPath: peer.context.projectPath }
      }))
      if (new Set(peers.map(p => JSON.stringify([p.ref.environmentId, p.ref.sessionId]))).size !== peers.length) throw new LayoutControlError('invalid', 'sessionIds contains duplicate session identities.')
      if (navigation!.stale()) return withLayoutActionState(caller, request, { ...superseded(), targetSession: resolved.ref, layout: await sessionLayoutSnapshot() }, resolved.context)
      for (const peer of [resolved.context, ...peers]) assertLayoutEnvironmentEnabled(peer.projectPath)
      const result = await applyMosaicAction(request, { ref: resolved.ref, projectPath: resolved.context.projectPath }, peers, navigation!)
      return withLayoutActionState(caller, request, { ...result, targetSession: resolved.ref, layout: await sessionLayoutSnapshot() }, resolved.context)
    }
    if (signal?.aborted) return withLayoutActionState(caller, request, { ...superseded(), targetSession: resolved.ref }, resolved.context)
    const result = await layoutAct(caller, request, resolved.context)
    return withLayoutActionState(caller, request, { ...result, targetSession: resolved.ref }, resolved.context)
  } finally {
    navigation?.dispose()
  }
}
