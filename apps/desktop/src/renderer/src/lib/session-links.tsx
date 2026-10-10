import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'
import i18n from 'i18next'
import type { SessionRef } from '@superone/shared/environment/refs'
import { unwrapIpcInvokeError } from '@superone/shared/ipc-error'
import { SessionLinkContext, type SessionLinkPorts } from '@superone/chat-view/presenters/SessionChip'
import { createSessionLinkCache } from '@superone/chat-view/presenters/session-link-cache'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'

let navigationGeneration = 0
export async function openSessionLink(ref: SessionRef): Promise<void> {
  const generation = ++navigationGeneration
  const source = useChatStore.getState()
  const sourceProject = source.activeProject
  const sourceSession = sourceProject ? source.projectSessions[sourceProject]?._activeSessionId : null
  const target = await window.environment.sessionLinkTarget(ref)
  if (generation !== navigationGeneration) return
  if (target.ref.environmentId !== ref.environmentId || target.ref.sessionId !== ref.sessionId) throw new Error('Session target mismatch')
  if (target.projectPath === sourceProject && ref.sessionId === sourceSession) return
  if (target.connectionId) {
    if (!await window.environment.getSession(target.connectionId, ref.sessionId)) throw new Error('Session could not be restored')
  } else if (!await window.app.loadSessionState(ref.sessionId)) throw new Error('Session could not be restored')
  if (generation !== navigationGeneration || useChatStore.getState().activeProject !== sourceProject) return
  if (sourceProject && useChatStore.getState().projectSessions[sourceProject]?._activeSessionId !== sourceSession) return
  try {
    if (useMosaicStore.getState().mode === 'mosaic') await useChatStore.getState().mountSession(target.projectPath, ref.sessionId)
    await useChatStore.getState().switchToSession(target.projectPath, ref.sessionId)
    useMosaicStore.getState().focusOrReplaceFocused(target.projectPath, ref.sessionId)
  } catch (error) {
    if (generation === navigationGeneration && useChatStore.getState().activeProject === target.projectPath && sourceProject && sourceSession) await useChatStore.getState().switchToSession(sourceProject, sourceSession)
    throw error
  }
}

export const desktopSessionLinkPorts: SessionLinkPorts = {
  cache: createSessionLinkCache(refs => window.environment.sessionLinkMetadata(refs)),
  open: openSessionLink,
  onError: error => {
    const message = unwrapIpcInvokeError(error instanceof Error ? error.message : 'Could not open session')
    toast.error(/^health probe failed\b/i.test(message) ? i18n.t('chat.send.remoteUnavailable') : message)
    if (message.includes('Unknown session environment')) {
      useAppStore.getState().setSettingsTab('remote')
      useAppStore.getState().navigateTo('settings')
    }
  },
}

const ports = desktopSessionLinkPorts
const sourceIds = new Map<string, Promise<string | null>>()
let consumers = 0
let dispose: (() => void) | undefined
function retainRoutes() {
  if (consumers++ === 0) {
    const invalidate = () => { sourceIds.clear(); ports.cache.clear() }
    const unsubscribers = [window.environment?.onStatusEvent?.(invalidate), window.app?.onSessionChanged?.(invalidate)]
    dispose = () => { unsubscribers.forEach(unsubscribe => unsubscribe?.()) }
  }
  return () => { if (--consumers === 0) { dispose?.(); dispose = undefined } }
}
export function sessionLinkSource(projectPath: string): Promise<string | null> {
  let pending = sourceIds.get(projectPath)
  if (!pending) {
    pending = window.environment.sessionSource(projectPath).catch(() => { sourceIds.delete(projectPath); return null })
    sourceIds.set(projectPath, pending)
    if (sourceIds.size > 256) sourceIds.delete(sourceIds.keys().next().value!)
  }
  return pending
}

export function DesktopSessionLinkScope({ projectPath, children }: { projectPath?: string | null; children: ReactNode }) {
  useEffect(retainRoutes, [])
  const routeVersion = useSyncExternalStore(ports.cache.subscribe, ports.cache.getSnapshot, ports.cache.getSnapshot)
  const scope = useSessionScope()
  const sourcePath = scope?.projectPath ?? projectPath
  const [source, setSource] = useState<{ path: string; environmentId: string | null } | null>(null)
  useEffect(() => {
    if (!sourcePath || !window.environment?.sessionSource) return
    let retired = false
    void sessionLinkSource(sourcePath).then(environmentId => { if (!retired) setSource({ path: sourcePath, environmentId }) }).catch(() => {})
    return () => { retired = true }
  }, [sourcePath, routeVersion])
  return <SessionLinkContext.Provider value={{ sourceEnvironmentId: source && source.path === sourcePath ? source.environmentId : null, ports }}>{children}</SessionLinkContext.Provider>
}
