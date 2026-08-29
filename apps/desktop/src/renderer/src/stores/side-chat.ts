/**
 * Side chat — one ephemeral fork of the foreground conversation, docked in the
 * activity panel beside it.
 *
 * Exactly one exists at a time. It lives in `useChatStore` like any other
 * session so `SessionPane` can render it unchanged, but it is never
 * `_activeSessionId` and never reaches the database: the main process created it
 * with `ephemeral: true`, which withholds the persistence hooks entirely.
 *
 * Closing the tab is destructive by design and the only way it ends.
 */

import { create } from 'zustand'
import type { CodexReasoningEffort, EffortLevel, HarnessId } from '@superone/shared/agent-types'
import { useChatStore, lastTouchedPane, markPaneTouched } from './chat'
import { createDefaultPerSessionState } from './chat-store/defaults'

export interface SideChat {
  /** SuperOne session id of the side chat itself. */
  sessionId: string
  /** Conversation it was forked from. */
  parentSessionId: string
  projectPath: string
  harnessId: HarnessId
}

/**
 * Which warning the confirm dialog is showing.
 *
 * Both destroy the open side chat, so both must be confirmed; they differ only
 * in what the user was trying to do, and saying the wrong one ("Close?" when
 * they clicked New Side Chat) is how a user learns to click through warnings.
 */
export type SideChatConfirmKind = 'close' | 'replace'

/**
 * "Don't ask again" for the close warning.
 *
 * localStorage rather than app settings, matching the delete-session confirm
 * (`session-delete-helpers`): a per-device UI habit, not a synced preference.
 * Only the close dialog offers it — replacing a side chat destroys one the user
 * is not looking at, which is worth a prompt every time.
 */
const SKIP_CLOSE_CONFIRM_KEY = 'super-one.side-chat.skip-close-confirm'

export function shouldSkipCloseConfirm(): boolean {
  return globalThis.localStorage?.getItem(SKIP_CLOSE_CONFIRM_KEY) === 'true'
}

export function setSkipCloseConfirm(): void {
  globalThis.localStorage?.setItem(SKIP_CLOSE_CONFIRM_KEY, 'true')
}

interface SideChatStore {
  current: SideChat | null
  confirm: { kind: SideChatConfirmKind; resolve: (confirmed: boolean) => void } | null
  _set: (chat: SideChat | null) => void
  /** Resolves once the user answers the dialog. Resolves false if one is already open. */
  askConfirm: (kind: SideChatConfirmKind) => Promise<boolean>
  resolveConfirm: (confirmed: boolean) => void
}

export const useSideChatStore = create<SideChatStore>((set, get) => ({
  current: null,
  confirm: null,
  _set: (chat) => set({ current: chat }),
  askConfirm: (kind) => {
    if (get().confirm) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => set({ confirm: { kind, resolve } }))
  },
  resolveConfirm: (confirmed) => {
    const pending = get().confirm
    if (!pending) return
    set({ confirm: null })
    pending.resolve(confirmed)
  },
}))

/**
 * Register a side-chat session in the chat store.
 *
 * Seeds only what the composer and transcript read: cwd, harness, model. The
 * transcript starts empty on purpose — the agent carries the parent's context,
 * but replaying that whole conversation into a narrow panel would bury the one
 * question the user opened it to ask.
 */
function registerSession(
  projectPath: string,
  sessionId: string,
  parentSessionId: string,
  init: {
    cwd: string
    harnessId: HarnessId
    apiProviderId: string | null
    acpAgentId: string | null
    selectedModel: string | null
    selectedEffort: string | null
    agentPreset: string | null
  },
): void {
  useChatStore.setState((s) => {
    const project = s.projectSessions[projectPath]
    if (!project) return s
    const session = createDefaultPerSessionState()
    session.cwd = init.cwd
    session.sessionProvider = init.harnessId
    session.preferredProvider = init.harnessId
    session.apiProviderId = init.apiProviderId
    session.acpAgentId = init.acpAgentId
    // Codex keeps its pick in its own pair of fields; writing only
    // `selectedModel` would leave the picker showing the catalog default while
    // the forked session actually runs the parent's model.
    if (init.harnessId === 'codex') {
      session.selectedCodexModel = init.selectedModel ?? ''
      session.selectedCodexReasoningEffort = (init.selectedEffort ?? undefined) as CodexReasoningEffort | undefined
      session.codexModelUserChosen = !!init.selectedModel
    } else {
      session.selectedModel = init.selectedModel ?? ''
      session.selectedEffort = (init.selectedEffort ?? undefined) as EffortLevel | undefined
      session.modelUserChosen = !!init.selectedModel
    }
    // dsh resumes the forked durable log, which is authoritative for the preset.
    // Seeding the picker's draft with the preset the fork actually inherited is
    // what stops it from showing the roster's first entry instead.
    if (init.agentPreset) session.dshPreset = init.agentPreset
    session._sideChatParentId = parentSessionId
    // Deliberately leaves `_activeSessionId` alone: the parent stays the session
    // the sidebar, header and keyboard shortcuts act on.
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...project,
          _sessions: { ...project._sessions, [sessionId]: session },
        },
      },
    }
  })
  // Mounting is what keeps the row alive. A side chat is never the project's
  // active session, so the first `status_change: idle` would otherwise evict it
  // from `_sessions` and the panel would fall back to a default session view.
  void useChatStore.getState().mountSession(projectPath, sessionId)
}

function unregisterSession(projectPath: string, sessionId: string): void {
  // Forget the pane before the row goes: a window-level shortcut that falls back
  // to "the pane the user last touched" must not keep naming a disposed session.
  const remembered = lastTouchedPane()
  if (remembered?.projectPath === projectPath && remembered.sessionId === sessionId) {
    markPaneTouched(null)
  }
  useChatStore.getState().unmountSession(projectPath, sessionId)
  useChatStore.setState((s) => {
    const project = s.projectSessions[projectPath]
    if (!project?._sessions[sessionId]) return s
    const { [sessionId]: _dropped, ...rest } = project._sessions
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: { ...project, _sessions: rest },
      },
    }
  })
}

export type OpenSideChatResult =
  | { ok: true; chat: SideChat }
  | { ok: false; error: string }

/**
 * Serialises open/close so the single-instance rule survives concurrency.
 *
 * `openSideChat` awaits a fork round-trip before it can record anything in
 * `current`, so two calls that start while `current` is still null — a
 * double-clicked menu item, the header entry racing `/side` — would both fork,
 * both create a main-process session, and both register a row. The later one
 * wins `current` and the dock tab; the earlier one becomes an orphan whose
 * runtime, `_sessions` row and mount have no reachable close path, because the
 * tab-removal handler is (correctly) guarded on the id it no longer matches.
 */
let sideChatMutation: Promise<unknown> = Promise.resolve()

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = sideChatMutation.then(work, work)
  // Keep the chain alive past a rejection; the caller still sees the failure.
  sideChatMutation = next.then(() => undefined, () => undefined)
  return next
}

/**
 * Fork `parentSessionId` into a side chat and register it locally.
 *
 * Callers are responsible for confirming a replace first — this unconditionally
 * discards any side chat already open, because two would need two tabs and the
 * feature is deliberately single-instance.
 */
export function openSideChat(
  projectPath: string,
  parentSessionId: string,
): Promise<OpenSideChatResult> {
  return serialize(() => openSideChatUnserialized(projectPath, parentSessionId))
}

async function openSideChatUnserialized(
  projectPath: string,
  parentSessionId: string,
): Promise<OpenSideChatResult> {
  await closeSideChatUnserialized()

  const parent = useChatStore.getState().projectSessions[projectPath]?._sessions[parentSessionId]

  const result = await window.app.startSideChat({ parentSessionId })
  if (!result.ok) return { ok: false, error: result.error }

  // The main process only knows a model once one has been pushed to it, so a
  // conversation left on the catalog default answers `null` here. The picker
  // the user was looking at reads the renderer's copy, so fall back to that —
  // otherwise the side chat opens showing a different model from the chat it
  // forked from, and the composer's "fill in the default" effect then writes
  // that difference back as a real selection.
  const parentModel = result.harnessId === 'codex' ? parent?.selectedCodexModel : parent?.selectedModel
  const parentEffort = result.harnessId === 'codex' ? parent?.selectedCodexReasoningEffort : parent?.selectedEffort

  registerSession(result.projectPath, result.sessionId, parentSessionId, {
    cwd: result.cwd,
    harnessId: result.harnessId,
    apiProviderId: result.apiProviderId,
    acpAgentId: result.acpAgentId,
    selectedModel: result.selectedModel ?? parentModel ?? null,
    selectedEffort: result.selectedEffort ?? parentEffort ?? null,
    agentPreset: result.agentPreset ?? parent?.dshPreset ?? null,
  })
  const chat: SideChat = {
    sessionId: result.sessionId,
    parentSessionId,
    projectPath: result.projectPath,
    harnessId: result.harnessId,
  }
  useSideChatStore.getState()._set(chat)
  return { ok: true, chat }
}

/**
 * Discard the open side chat. Safe to call when none is open.
 *
 * Order matters: the chat-store row is dropped only after the main process has
 * disposed the runtime, so nothing can stream into a session that no longer has
 * anywhere to render. `current` clears first so a concurrent open cannot decide
 * it still needs to confirm a replace.
 */
export function closeSideChat(): Promise<void> {
  return serialize(closeSideChatUnserialized)
}

async function closeSideChatUnserialized(): Promise<void> {
  const chat = useSideChatStore.getState().current
  if (!chat) return
  useSideChatStore.getState()._set(null)
  try {
    await window.app.closeSideChat(chat.sessionId)
  } finally {
    unregisterSession(chat.projectPath, chat.sessionId)
  }
}
