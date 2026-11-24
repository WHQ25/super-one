import type { SendMessageRequest } from '@superone/shared/agent-types'
import { parseTagsJson } from '@superone/shared/session-tags'
import {
  MENTION_CONTEXT_GH_TIMEOUT_MS,
  enrichMentionContext,
  hasMentionContextTargets,
  type MentionContextDeps,
  type MentionedSessionData,
} from '@superone/runtime/session/mention-context'
import { ghRun } from '../git-run'

export async function readDesktopMentionedSession(sessionId: string): Promise<MentionedSessionData | null> {
  try {
    const [{ getDb }, { loadSessionState }] = await Promise.all([
      import('../database'),
      import('../db-sessions'),
    ])
    const state = loadSessionState(sessionId)
    if (!state) return null
    const row = getDb().prepare(`
      SELECT created_at, last_user_message_at, tags_json
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as {
      created_at?: string | null
      last_user_message_at?: string | null
      tags_json?: string | null
    } | undefined
    return {
      sessionId,
      title: state.title,
      harness: state.provider,
      model: state.selectedModel,
      branch: state.gitBranch,
      createdAt: row?.created_at ?? null,
      lastActiveAt: row?.last_user_message_at ?? row?.created_at ?? null,
      messageCount: state.messages.length,
      tags: parseTagsJson(row?.tags_json),
      messages: state.messages,
    }
  } catch {
    return null
  }
}

export async function withDesktopMentionContext(
  request: SendMessageRequest,
  opts: {
    cwd: string
    sessionId: string
    gh?: MentionContextDeps['gh']
    readSession?: MentionContextDeps['readSession']
  },
): Promise<SendMessageRequest> {
  const targetText = request.codex?.prompt ?? request.content
  if (!hasMentionContextTargets(targetText)) return request
  const enriched = await enrichMentionContext(targetText, {
    gh: opts.gh ?? ((args) => ghRun(opts.cwd, args, MENTION_CONTEXT_GH_TIMEOUT_MS)),
    readSession: opts.readSession ?? readDesktopMentionedSession,
    skipSessionId: opts.sessionId,
  })
  if (enriched === targetText) return request
  if (request.codex?.prompt !== undefined) {
    return {
      ...request,
      codex: { ...request.codex, prompt: enriched },
    }
  }
  return {
    ...request,
    content: enriched,
  }
}
