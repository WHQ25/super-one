/**
 * Continue a long session whose prompt cache expired in a new session
 * (docs/features/session-continuation.md). The new session is an unsent draft
 * on the same project, checkout, harness and settings whose composer holds a
 * mention of the old session followed by the old session's unsent draft. Its
 * host creates it on first send and hands it the old session's channels.
 */

import type { JSONContent } from '@tiptap/core'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createSessionId } from '@/stores/chat-store/defaults'
import { applyCachedCodexPermissionPreset } from '@/stores/chat-store/helpers/prefs-cache'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { projectClaudeModels } from '@/stores/chat-store/helpers/store-helpers'
import { seedNewSession } from '@/harness-ui/strategies'
import { parseRemoteProjectKey } from './remote-project-key'
import {
  applyDraftWorktreeUi,
  projectSandboxFromSettings,
  sessionFieldsFromSettings,
  snapshotDraftSettings,
} from '@/stores/chat-store/helpers/draft-promote'
import type { Mention, PerSessionState } from '@/stores/chat-store/types'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { plainTextToTiptapDoc } from '@/components/chat/chat-input/plainTextToTiptapDoc'
import { selectSessionTitle } from './session-title'
import { activateSession } from './draft-resume'

function buildSessionMentionDraft(
  from: { sessionId: string; title: string; upToMessageId?: string },
  prior?: PerSessionState,
): Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments' | 'mentions'> {
  const mention: Mention = {
    kind: 'session',
    value: from.sessionId,
    displayName: from.title,
    ...(from.upToMessageId ? { upToMessageId: from.upToMessageId } : {}),
  }
  const priorJson = prior ? (prior.draftJson ?? plainTextToTiptapDoc(prior.draftText)) as JSONContent : null
  const priorContent = prior?.draftText.trim() ? priorJson?.content ?? [] : []
  const priorMentions = prior ? prior.mentions.filter((m) => !(m.kind === 'session' && m.value === from.sessionId)) : []
  return {
    draftText: [`@${from.title}`, prior?.draftText ?? ''].filter((part) => part.trim()).join(' '),
    draftJson: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { ...mention } }, { type: 'text', text: ' ' }] },
        ...priorContent,
      ],
    },
    attachments: prior ? [...prior.attachments] : [],
    mentions: [mention, ...priorMentions],
  }
}

/** The composer of the new session: the old session as a mention chip, then its unsent draft. */
export function continuationDraft(from: { sessionId: string; title: string; session: PerSessionState }): Pick<
  PerSessionState, 'draftText' | 'draftJson' | 'attachments' | 'mentions'
> {
  return buildSessionMentionDraft({ sessionId: from.sessionId, title: from.title }, from.session)
}

function openDraftFromSession(
  projectPath: string,
  fromSessionId: string,
  opts: { continues?: boolean; upToMessageId?: string },
): string | null {
  const state = useChatStore.getState()
  const project = state.projectSessions[projectPath]
  const session = project?._sessions[fromSessionId]
  if (!project || !session) return null
  const settings = {
    ...snapshotDraftSettings(session, project, null),
    ...(opts.continues ? { continuesFrom: fromSessionId } : {}),
  }
  const base = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
  base.cwd = projectPath
  if (!parseRemoteProjectKey(projectPath)) {
    seedNewSession(base, resolveProvider(session), {
      state,
      project,
      claudeModels: projectClaudeModels(state, projectPath),
      previousSession: session,
    })
  } else if (session.acpModels.length > 0 || session.acpModes.length > 0) {
    base.acpModels = session.acpModels
    base.acpModelConfigId = session.acpModelConfigId
    base.acpModelsStatus = session.acpModelsStatus
    base.acpModes = session.acpModes
    base.acpModeConfigId = session.acpModeConfigId
    base.acpModesStatus = session.acpModesStatus
    base.acpSlashCommands = session.acpSlashCommands
  }
  const title = selectSessionTitle(state, projectPath, fromSessionId)
  const next: PerSessionState = {
    ...base,
    ...sessionFieldsFromSettings(settings),
    ...buildSessionMentionDraft(
      { sessionId: fromSessionId, title, upToMessageId: opts.upToMessageId },
      opts.continues ? session : undefined,
    ),
  }
  const sessionId = createSessionId()
  if (opts.continues) {
    // The draft moves: clear it where it was, which every window showing that session mirrors.
    const from = { projectPath, sessionId: fromSessionId }
    state.setDraftText('', from)
    state.setDraftJson(null, from)
    state.clearAttachments(from)
    for (const mention of session.mentions) state.removeMention(mention.value, from)
  }
  activateSession(projectPath, sessionId, next, projectSandboxFromSettings(settings))
  useMosaicStore.getState().focusOrReplaceFocused(projectPath, sessionId)
  applyDraftWorktreeUi(projectPath, settings)
  return sessionId
}

/** Open the continuation of `fromSessionId` and move its unsent draft there; returns the new session id. */
export function continueInNewSession(projectPath: string, fromSessionId: string): string | null {
  return openDraftFromSession(projectPath, fromSessionId, { continues: true })
}

export function handoffToNewSession(
  projectPath: string,
  fromSessionId: string,
  upToMessageId?: string,
): string | null {
  return openDraftFromSession(projectPath, fromSessionId, { upToMessageId })
}
