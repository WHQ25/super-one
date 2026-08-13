/**
 * Open a parked draft by putting its snapshotted session back in the store
 * and making it active. Do NOT go through switchSession — that path hydrates
 * from DB and reapplies catalog defaults, which is why opening a draft used
 * to show a fresh session with only the text restored.
 */

import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat-store'
import {
  applyDraftWorktreeUi,
  claimDraftForSession,
  draftProjectKey,
  getDraftIdForSession,
  getParkedDraft,
  isUnsentSession,
  projectSandboxFromSettings,
  promoteDraftIfUnsent,
  releaseParkedDraft,
  sessionFieldsFromSettings,
  type ParkedDraftSnapshot,
} from '@/stores/chat-store/helpers/draft-promote'
import { createDefaultPerSessionState, createSessionId } from '@/stores/chat-store/defaults'
import { applyCachedCodexPermissionPreset } from '@/stores/chat-store/helpers/prefs-cache'
import type { PerSessionState } from '@/stores/chat-store/types'
import { useDraftsStore } from '@/stores/drafts'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import type { DraftListEntry, DraftSessionSettings } from '@superone/shared/environment'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { _getSessionWorktreePath } from '@/stores/chat-store/helpers/persistence'

export interface ResumeDraftResult {
  ok: boolean
  reason?: 'failed'
}

function draftAttachments(draft: DraftListEntry): ImageAttachment[] {
  return draft.attachments.map((a) => ({
    name: a.name,
    mimeType: a.mimeType,
    base64: a.data,
    ...(a.id ? { id: a.id } : {}),
  }))
}

function resolvedSettings(draft: DraftListEntry): DraftSessionSettings {
  return {
    harness: draft.settings?.harness ?? draft.harness,
    model: draft.settings?.model ?? draft.model,
    permissionMode: draft.settings?.permissionMode ?? draft.permissionMode,
    ...draft.settings,
  }
}

function applyPersistedFields(sess: PerSessionState, draft: DraftListEntry): PerSessionState {
  return {
    ...sess,
    draftText: draft.text,
    draftJson: draft.docJson,
    attachments: draftAttachments(draft),
    draftId: draft.id,
    ...sessionFieldsFromSettings(resolvedSettings(draft)),
  }
}

function activateSession(
  projectPath: string,
  sessionId: string,
  session: PerSessionState,
  sandbox: ParkedDraftSnapshot['sandboxInfo'],
): void {
  useChatStore.setState((s) => {
    const existing = s.projectSessions[projectPath]
    if (!existing) return {}
    return {
      activeProject: projectPath,
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...existing,
          ...(sandbox ? { sandboxInfo: sandbox } : {}),
          _activeSessionId: sessionId,
          _sessions: {
            ...existing._sessions,
            [sessionId]: session,
          },
        },
      },
    }
  })
  const wt = _getSessionWorktreePath(session)
  useAppStore.getState().setActiveWorktree(projectPath, wt)
}

function draftTrace(type: string, data: unknown, tag?: string): void {
  window.app?.trace?.('drafts', type, data, tag)
}

function readActiveConfig(projectPath: string, sessionId: string): Record<string, unknown> {
  const proj = useChatStore.getState().projectSessions[projectPath]
  const sess = proj?._sessions[sessionId]
  return {
    activeProject: useChatStore.getState().activeProject,
    activeSid: proj?._activeSessionId,
    sessionProvider: sess?.sessionProvider,
    preferredProvider: sess?.preferredProvider,
    selectedModel: sess?.selectedModel,
    selectedEffort: sess?.selectedEffort,
    selectedCodexModel: sess?.selectedCodexModel,
    permissionMode: sess?.permissionMode,
    worktree: sess?._worktreePath,
    gitBranch: sess?._gitBranch,
    sandbox: proj?.sandboxInfo,
    textLen: sess?.draftText?.length ?? 0,
  }
}

export async function resumeDraft(
  connectionId: string,
  draft: DraftListEntry,
): Promise<ResumeDraftResult> {
  const projectKey = draftProjectKey(connectionId, draft.projectPath)
  draftTrace('resume_click', {
    connectionId,
    projectKey,
    draftId: draft.id,
    originSessionId: draft.originSessionId,
    harness: draft.harness,
    model: draft.model,
    permissionMode: draft.permissionMode,
    settings: draft.settings,
    textLen: draft.text?.length ?? 0,
  })
  if (!projectKey) {
    draftTrace('resume_abort', { reason: 'failed' })
    return { ok: false, reason: 'failed' }
  }

  try {
    const chat = useChatStore.getState()
    // Already on this origin: do not re-apply a parked/persisted snapshot over
    // keystrokes typed since the last flush.
    if (
      chat.activeProject === projectKey
      && draft.originSessionId
      && chat.projectSessions[projectKey]?._activeSessionId === draft.originSessionId
    ) {
      draftTrace('resume_already_active', { projectKey, sessionId: draft.originSessionId }, draft.id)
      return { ok: true }
    }
    chat.ensureSession(projectKey)
    // Hide the clicked row for the whole resume — promoting the outgoing draft
    // below lands its row before the awaited project switch drops this one.
    useDraftsStore.getState().setResumingDraft(draft.id)

    if (useAppStore.getState().selectedHostConnectionId !== connectionId) {
      useAppStore.setState({ selectedHostConnectionId: connectionId })
    }

    const leaving = chat.activeProject
    if (leaving) {
      const leavingSid = chat.projectSessions[leaving]?._activeSessionId ?? null
      const openId = leavingSid ? getDraftIdForSession(leavingSid) : undefined
      draftTrace('resume_leaving', { leaving, leavingSid, openId, draftId: draft.id }, draft.id)
      if (leavingSid && openId !== draft.id) {
        await promoteDraftIfUnsent(useChatStore.getState(), leaving, leavingSid)
      }
    }

    const parked = getParkedDraft(draft.id)
    const settings = resolvedSettings(draft)

    // Open the draft's project first. Sidebar hops no longer carry the draft,
    // so this must actually switch workspace + file tree — not just chat.activeProject.
    if (useChatStore.getState().activeProject !== projectKey) {
      await useAppStore.getState().selectProject(projectKey, {
        connectionId,
        carryOpenDraft: false,
      })
    }
    useChatStore.getState().ensureSession(projectKey)

    draftTrace('resume_resolve', {
      hasParked: !!parked,
      parkedSid: parked?.sessionId,
      parkedProject: parked?.projectPath,
      parkedProvider: parked?.session.sessionProvider ?? parked?.session.preferredProvider,
      parkedModel: parked?.session.selectedModel,
      parkedCodex: parked?.session.selectedCodexModel,
      parkedPermission: parked?.session.permissionMode,
      resolvedSettings: settings,
    })

    let sid = ''
    let targetProject = projectKey
    if (parked) {
      const restored = applyPersistedFields(parked.session, draft)
      draftTrace('resume_path_parked', {
        restoredProvider: restored.sessionProvider ?? restored.preferredProvider,
        restoredModel: restored.selectedModel,
        restoredCodex: restored.selectedCodexModel,
        restoredPermission: restored.permissionMode,
      })
      chat.ensureSession(parked.projectPath)
      activateSession(
        parked.projectPath,
        parked.sessionId,
        restored,
        parked.sandboxInfo ?? projectSandboxFromSettings(settings),
      )
      sid = parked.sessionId
      targetProject = parked.projectPath
      claimDraftForSession(parked.sessionId, draft.id)
      const mosaic = useMosaicStore.getState().focusOrReplaceFocused(parked.projectPath, parked.sessionId)
      draftTrace('resume_after_parked', {
        mosaicHandled: mosaic,
        ...readActiveConfig(parked.projectPath, parked.sessionId),
      })
    } else {
      const newSid = draft.originSessionId && isUnsentSession(
        useChatStore.getState().projectSessions[projectKey]?._sessions[draft.originSessionId],
      )
        ? draft.originSessionId
        : createSessionId()
      const existing = useChatStore.getState().projectSessions[projectKey]?._sessions[newSid]
      const base = existing
        ? { ...existing }
        : applyCachedCodexPermissionPreset(createDefaultPerSessionState())
      base.cwd = projectKey
      const restored = applyPersistedFields(base, draft)
      draftTrace('resume_path_mint', {
        newSid,
        reusedOrigin: newSid === draft.originSessionId,
        restoredProvider: restored.sessionProvider ?? restored.preferredProvider,
        restoredModel: restored.selectedModel,
        restoredCodex: restored.selectedCodexModel,
        restoredPermission: restored.permissionMode,
      })
      activateSession(
        projectKey,
        newSid,
        restored,
        projectSandboxFromSettings(settings),
      )
      sid = newSid
      claimDraftForSession(newSid, draft.id)
      const mosaic = useMosaicStore.getState().focusOrReplaceFocused(projectKey, newSid)
      draftTrace('resume_after_mint', {
        mosaicHandled: mosaic,
        ...readActiveConfig(projectKey, newSid),
      })
    }

    applyDraftWorktreeUi(targetProject, {
      ...settings,
      worktreePath: settings.worktreePath ?? _getSessionWorktreePath(
        useChatStore.getState().projectSessions[targetProject]?._sessions[sid],
      ),
    })
    draftTrace('resume_workspace', {
      projectKey: targetProject,
      appFolder: useAppStore.getState().currentFolder,
      worktree: useAppStore.getState()._worktrees[targetProject]?.activePath ?? null,
      pending: useAppStore.getState()._worktrees[targetProject]?.pendingBaseBranch ?? null,
    }, draft.id)

    releaseParkedDraft(draft.id)
    // Only stop hiding once the row is really gone, so it cannot flash back in.
    void useDraftsStore.getState().removeDraft(connectionId, draft.id).finally(() => {
      useDraftsStore.getState().setResumingDraft(null)
    })
    queueMicrotask(() => {
      draftTrace('resume_after_microtask', readActiveConfig(targetProject, sid), draft.id)
    })
    setTimeout(() => {
      draftTrace('resume_after_300ms', readActiveConfig(targetProject, sid), draft.id)
    }, 300)
    return { ok: true }
  } catch (err) {
    // Resume died mid-way — put the row back so the draft is not stranded.
    useDraftsStore.getState().setResumingDraft(null)
    draftTrace('resume_failed', { err: err instanceof Error ? err.message : String(err) }, draft.id)
    return { ok: false, reason: 'failed' }
  }
}
