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

/** The composer of the new session: the old session as a mention chip, then its unsent draft. */
export function continuationDraft(from: { sessionId: string; title: string; session: PerSessionState }): Pick<
  PerSessionState, 'draftText' | 'draftJson' | 'attachments' | 'mentions'
> {
  const mention: Mention = { kind: 'session', value: from.sessionId, displayName: from.title }
  const prior = (from.session.draftJson ?? plainTextToTiptapDoc(from.session.draftText)) as JSONContent
  const priorContent = from.session.draftText.trim() ? prior.content ?? [] : []
  return {
    draftText: [`@${from.title}`, from.session.draftText].filter((part) => part.trim()).join(' '),
    draftJson: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { ...mention } }, { type: 'text', text: ' ' }] },
        ...priorContent,
      ],
    },
    attachments: [...from.session.attachments],
    mentions: [mention, ...from.session.mentions.filter((m) => !(m.kind === 'session' && m.value === from.sessionId))],
  }
}

/** Open the continuation of `fromSessionId` and move its unsent draft there; returns the new session id. */
export function continueInNewSession(projectPath: string, fromSessionId: string): string | null {
  const state = useChatStore.getState()
  const project = state.projectSessions[projectPath]
  const session = project?._sessions[fromSessionId]
  if (!project || !session) return null
  const settings = { ...snapshotDraftSettings(session, project, null), continuesFrom: fromSessionId }
  const base = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
  base.cwd = projectPath
  const next: PerSessionState = {
    ...base,
    ...sessionFieldsFromSettings(settings),
    ...continuationDraft({ sessionId: fromSessionId, title: selectSessionTitle(state, projectPath, fromSessionId), session }),
  }
  const sessionId = createSessionId()
  // The draft moves: clear it where it was, which every window showing that session mirrors.
  const from = { projectPath, sessionId: fromSessionId }
  state.setDraftText('', from)
  state.setDraftJson(null, from)
  state.clearAttachments(from)
  for (const mention of session.mentions) state.removeMention(mention.value, from)
  activateSession(projectPath, sessionId, next, projectSandboxFromSettings(settings))
  useMosaicStore.getState().focusOrReplaceFocused(projectPath, sessionId)
  applyDraftWorktreeUi(projectPath, settings)
  return sessionId
}
