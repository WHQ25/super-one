import { useSyncExternalStore } from 'react'
import i18n from 'i18next'
import { toast } from 'sonner'
import { ModUiClient, windowViewport } from '@superone/chat-view/mod-ui'
import type { AgentEvent, AppSettings } from '@superone/shared/agent-types'
import { MOD_UI_UNAVAILABLE, type ModHostReply, type ModHostRequest, type ModUiRequest, type ModUiResult } from '@superone/shared/mod-ui'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { useChatStore } from '@/stores/chat'
import { tryCopy } from '@/lib/clipboard'
import { getModComposer } from './composer-bridge'
import { replyToHostRequest } from './host-requests'

/**
 * Desktop's mod clients, one per session (`@superone/chat-view/mod-ui`). The
 * desktop is a single remote surface (`desktop`) for every session it shows:
 * mosaic tiles and windows on one session share its client and tree cache.
 */

const CLIENT_ID = 'superone-desktop'
const clients = new Map<string, ModUiClient>()
const sessionProject = new Map<string, string>()
const heldToasts = new Map<string, Array<() => void>>()

function connectionOf(projectPath: string): string {
  return parseRemoteProjectKey(projectPath)?.connectionId ?? 'local'
}

function isUnavailable(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null
  return !!e && (e.name === MOD_UI_UNAVAILABLE || (e.message ?? '').includes(MOD_UI_UNAVAILABLE))
}

/**
 * The "Draw Mod Interfaces" preference (`agentPreference.claude.drawModInterfaces`),
 * `null` until read. Off, no client attaches and every site draws SuperOne's own.
 */
let drawMods: boolean | null = null
let drawModsWatched = false
const drawModsListeners = new Set<() => void>()
/** Sessions that announced mods while the preference was off or not read yet. */
const pendingSessions = new Map<string, string>()

function watchDrawMods(): void {
  if (drawModsWatched) return
  drawModsWatched = true
  let changed = false
  window.app.onAppSettingsChange((settings) => {
    changed = true
    setDrawMods(settings)
  })
  window.app.getAppSettings()
    .then((settings) => { if (!changed) setDrawMods(settings) })
    .catch((err: unknown) => console.warn('[mod-ui] reading the preference failed:', err))
}

function setDrawMods(settings: AppSettings): void {
  const on = settings.agentPreference.claude.drawModInterfaces
  if (on === drawMods) return
  drawMods = on
  if (on) {
    for (const [sessionId, projectPath] of pendingSessions) getModUiClient(projectPath, sessionId)
    pendingSessions.clear()
  } else {
    for (const sessionId of [...clients.keys()]) {
      // Nothing holds a toast once no pane is drawn.
      for (const show of heldToasts.get(sessionId) ?? []) show()
      disposeModUiClient(sessionId)
    }
  }
  for (const listener of drawModsListeners) listener()
}

/** Re-renders on the preference; whether the desktop draws mods at all. */
export function useDrawModInterfaces(): boolean {
  return useSyncExternalStore(subscribeDrawMods, () => drawMods === true)
}

function subscribeDrawMods(listener: () => void): () => void {
  watchDrawMods()
  drawModsListeners.add(listener)
  return () => drawModsListeners.delete(listener)
}

/**
 * The session's client, created (and attached, if the session already draws
 * mods) on first use; `null` while the preference is off or not read yet.
 */
export function getModUiClient(projectPath: string, sessionId: string): ModUiClient | null {
  watchDrawMods()
  let client = clients.get(sessionId)
  if (client) return client
  if (drawMods !== true) return null
  const connectionId = connectionOf(projectPath)
  sessionProject.set(sessionId, projectPath)
  client = new ModUiClient({
    surface: 'desktop',
    clientId: CLIENT_ID,
    answers: ['copy', 'promptRead', 'promptFill', 'promptSuggest'],
    transport: (op, request) => window.environment.modUi(connectionId, sessionId, op, request),
    viewport: () => windowViewport(true),
    hostHandler: (request) => answerHostRequest(projectPath, sessionId, request),
    onError: (op, err) => {
      if (isUnavailable(err)) return
      console.warn('[mod-ui] %s failed:', op, err)
    },
  })
  client.subscribe(() => flushHeldToasts(sessionId))
  clients.set(sessionId, client)
  // A session that was already live (renderer reload, view opened later) never
  // re-announces `mod_ui_state`; attaching is idempotent and fails closed.
  void client.attach()
  return client
}

/**
 * Whether the session's composer edits go to its `prompt.edit` chain. Local
 * sessions only: a round trip costs well under a millisecond over stdio, but a
 * keystroke per network round trip to a remote node does not.
 */
export function relaysPromptEdits(sessionId: string): boolean {
  const projectPath = sessionProject.get(sessionId)
  return !!clients.get(sessionId)?.isAvailable && !!projectPath && connectionOf(projectPath) === 'local'
}

/** Relays one composer edit to the session's `prompt.edit` chain. */
export function sendPromptEdit(sessionId: string, request: Omit<ModUiRequest<'promptEdit'>, 'surface' | 'clientId'>): Promise<ModUiResult<'promptEdit'> | null> {
  const client = clients.get(sessionId)
  if (!client || !relaysPromptEdits(sessionId)) return Promise.resolve(null)
  return client.act('promptEdit', { ...request, surface: client.surface, clientId: client.clientId })
}

/** Feeds a session event to its client. Returns true for mod events. */
export function routeModEvent(event: AgentEvent, projectPath: string, sessionId: string | undefined): boolean {
  if (!event.type.startsWith('mod_') || !sessionId) return false
  const existing = clients.get(sessionId)
  // The preference and the session's own announcement can arrive in either order.
  if (!existing && drawMods !== true) {
    watchDrawMods()
    if (event.type === 'mod_ui_state') {
      if (event.available) pendingSessions.set(sessionId, projectPath)
      else pendingSessions.delete(sessionId)
    }
    return true
  }
  // A session nobody views yet still needs its client to answer host requests.
  const client = existing ?? (event.type === 'mod_ui_state' && !event.available ? null : getModUiClient(projectPath, sessionId))
  // A fresh client attaches by itself; its first state event would attach twice.
  if (client && (existing || event.type !== 'mod_ui_state')) client.handleEvent(event)
  return true
}

/**
 * A plugin's toast while a pane it opened with `holdToasts` is the one shown
 * waits for that pane to close, as the terminal does.
 */
export function showOrHoldModToast(sessionId: string | undefined, show: () => void): void {
  const client = sessionId ? clients.get(sessionId) : undefined
  const { roster } = client?.getState() ?? { roster: null }
  const shown = roster?.panes.find((p) => p.id === roster.shownId)
  if (!sessionId || !shown?.holdToasts) {
    show()
    return
  }
  const queue = heldToasts.get(sessionId) ?? []
  queue.push(show)
  heldToasts.set(sessionId, queue)
}

function flushHeldToasts(sessionId: string): void {
  const queue = heldToasts.get(sessionId)
  if (!queue?.length) return
  const { roster } = clients.get(sessionId)!.getState()
  if (roster.panes.find((p) => p.id === roster.shownId)?.holdToasts) return
  heldToasts.delete(sessionId)
  for (const show of queue) show()
}

/** The live facts and actions `replyToHostRequest` decides with. */
function answerHostRequest(projectPath: string, sessionId: string, request: ModHostRequest): Promise<ModHostReply> {
  const store = useChatStore.getState()
  const session = store.projectSessions[projectPath]?._sessions[sessionId]
  const plugin = request.kind === 'copy' ? request.plugin : ''
  return replyToHostRequest(session ? {
    draftText: session.draftText ?? '',
    isIdle: session.status === 'idle',
    isDeciding: session.pendingPermissions.length > 0 || !!session.pendingQuestion || !!session.pendingPlanApproval,
    composer: getModComposer(sessionId),
    setDraft: (text) => store.setDraftText(text, { projectPath, sessionId }),
    suggest: (text) => store.handleAgentEvent({ type: 'prompt_suggestion', suggestion: text, sessionId, projectPath } as AgentEvent),
    copy: async (text) => {
      const copied = await tryCopy(text)
      if (copied) toast(i18n.t('chat.mods.copiedToClipboard', { plugin }))
      return copied
    },
  } : null, request)
}

/** Detaches and forgets a session's client: the session was deleted, or mods were turned off. */
export function disposeModUiClient(sessionId: string): void {
  clients.get(sessionId)?.dispose()
  clients.delete(sessionId)
  sessionProject.delete(sessionId)
  heldToasts.delete(sessionId)
  pendingSessions.delete(sessionId)
}
