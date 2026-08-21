import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { findCheckpointTarget } from '../helpers/chat-helpers'
import type { PerSessionState } from '../types'

/**
 * System-message marker payload (`providerId: 'system'`).
 * - `recap` — still minted for session recap rows
 * - `summary` — legacy only (parsed for cleanup / old history); never minted now
 */
export const TURN_META_PREFIX = '__turn_meta__:'

/**
 * Slash commands whose stdout is a report meant for the user, not a side effect.
 * They run for minutes and return everything at once through
 * `<local-command-stdout>`, so hiding it behind the popup loses the entire result.
 * Add a command here when its output is the deliverable.
 */
const REPORT_OUTPUT_COMMANDS = new Set(['code-review', 'security-review'])

export type TurnMetaPayload =
  | { kind: 'summary'; text: string; promptId?: string }
  | { kind: 'recap'; text: string; auto?: boolean }

export function encodeTurnMeta(payload: TurnMetaPayload): string {
  return `${TURN_META_PREFIX}${JSON.stringify(payload)}`
}

export function parseTurnMetaText(text: string): TurnMetaPayload | null {
  if (!text.startsWith(TURN_META_PREFIX)) return null
  try {
    const raw = JSON.parse(text.slice(TURN_META_PREFIX.length)) as Record<string, unknown>
    const kind = raw.kind
    const body = typeof raw.text === 'string' ? raw.text.trim() : ''
    if (!body) return null
    if (kind === 'summary') {
      return {
        kind: 'summary',
        text: body,
        ...(typeof raw.promptId === 'string' && raw.promptId ? { promptId: raw.promptId } : {}),
      }
    }
    if (kind === 'recap') {
      return {
        kind: 'recap',
        text: body,
        ...(typeof raw.auto === 'boolean' ? { auto: raw.auto } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

function appendSystemTurnMeta(
  session: PerSessionState,
  payload: TurnMetaPayload,
  idPrefix: string,
): Partial<PerSessionState> {
  const msg: ChatMessage = {
    id: `${idPrefix}_${Date.now().toString(36)}`,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: encodeTurnMeta(payload) }],
    createdAt: new Date().toISOString(),
    providerId: 'system',
  }
  return { messages: [...session.messages, msg] }
}

/** True when `message` is a legacy system marker for this turn summary text. */
function isMatchingTurnSummaryMarker(message: ChatMessage, summary: string): boolean {
  if (message.providerId !== 'system') return false
  const first = message.content[0]
  if (!first || first.type !== 'text') return false
  const parsed = parseTurnMetaText(first.text)
  return parsed?.kind === 'summary' && parsed.text === summary
}

/**
 * Drop legacy `kind:summary` system markers once the summary lives on assistant
 * metadata — otherwise ChatContent renders both (above footer + below).
 */
function dropMatchingTurnSummaryMarkers(messages: ChatMessage[], summary: string): ChatMessage[] {
  const next = messages.filter((m) => !isMatchingTurnSummaryMarker(m, summary))
  return next.length === messages.length ? messages : next
}

/**
 * Attach Grok last-turn summary onto assistant `metadata.turnSummary` (above footer).
 * Never mints system markers — matches main runtime; orphan summaries are dropped.
 * Strips any legacy same-text `kind:summary` markers so dual Summary cannot reappear.
 */
function attachTurnSummaryToAssistant(
  session: PerSessionState,
  summary: string,
  messageId?: string,
): Partial<PerSessionState> {
  const messages = session.messages
  let idx = -1
  if (messageId) {
    idx = messages.findIndex(
      (m) => m.id === messageId && m.role === 'assistant' && m.providerId !== 'system',
    )
  }
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && m.providerId !== 'system') {
        idx = i
        break
      }
    }
  }
  // No assistant bubble to attach to — drop (same as main). Do not mint markers.
  if (idx < 0) return {}

  const target = messages[idx]
  const withoutMarkers = dropMatchingTurnSummaryMarkers(messages, summary)
  if (target.metadata?.turnSummary === summary) {
    if (withoutMarkers === messages) return {}
    return { messages: withoutMarkers }
  }
  // Re-find after marker drop — indices shift when markers precede the target.
  const attachIdx = withoutMarkers.findIndex((m) => m.id === target.id)
  if (attachIdx < 0) {
    return withoutMarkers === messages ? {} : { messages: withoutMarkers }
  }
  const next = withoutMarkers.slice()
  const base = next[attachIdx]
  next[attachIdx] = {
    ...base,
    metadata: {
      ...base.metadata,
      turnSummary: summary,
    },
  }
  return { messages: next }
}

type SlashEvent = Extract<AgentEvent, {
  type:
    | 'prompt_suggestion'
    | 'slash_command_output'
    | 'compact_boundary'
    | 'checkpoint_captured'
    | 'turn_summary'
    | 'session_recap'
    | 'session_recap_unavailable'
}>

export function reduceSlash(session: PerSessionState, event: SlashEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'prompt_suggestion':
      return { promptSuggestion: event.suggestion }

    case 'turn_summary': {
      const summary = event.summary.trim()
      if (!summary) return {}
      return attachTurnSummaryToAssistant(session, summary, event.messageId)
    }

    case 'session_recap': {
      const summary = event.summary.trim()
      if (!summary) return { isRecapping: false }
      return {
        ...appendSystemTurnMeta(session, {
          kind: 'recap',
          text: summary,
          ...(event.auto != null ? { auto: event.auto } : {}),
        }, 'session_recap'),
        isRecapping: false,
      }
    }

    case 'session_recap_unavailable':
      return { isRecapping: false }

    case 'compact_boundary': {
      const compactUserId = session._pendingCompactUserId
      const sourceMessageId = compactUserId ? event.messageId : undefined
      const msgs = compactUserId
        ? session.messages.filter((m) => m.id !== compactUserId && m.id !== sourceMessageId)
        : [...session.messages]
      let insertIdx = msgs.length
      if (!compactUserId) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            insertIdx = i
            break
          }
        }
      }
      msgs.splice(insertIdx, 0, {
        id: `compact_${Date.now()}`,
        role: 'assistant' as const,
        status: 'complete' as const,
        content: [{ type: 'text' as const, text: `__compact__:${event.trigger}:${event.preTokens}:${event.postTokens ?? ''}:${event.durationMs ?? ''}` }],
        createdAt: new Date().toISOString(),
        providerId: 'system',
      })
      return {
        isCompacting: false,
        compactError: null,
        messages: msgs,
        _pendingCompactUserId: '',
        ...(compactUserId ? { _pendingSlashCommand: '' } : {}),
      }
    }

    case 'slash_command_output': {
      const cmd = session._pendingSlashCommand
      const compactUserId = session._pendingCompactUserId
      const filtered = session.messages.filter(
        (m) => m.id !== event.messageId && (!compactUserId || m.id !== compactUserId),
      )
      if (cmd === 'compact') {
        if (!compactUserId) {
          const lastUserIdx = filtered.findLastIndex((m) => m.role === 'user')
          if (lastUserIdx >= 0) filtered.splice(lastUserIdx, 1)
        }
        return { _pendingSlashCommand: '', _pendingCompactUserId: '', messages: filtered }
      }
      // These commands return their whole deliverable as local-command stdout —
      // the report *is* the answer the user asked for, so it belongs in the
      // transcript as plain markdown. The default treatment below (drop the
      // message, leave "Command /x executed.", stash the text in a popup) is
      // right for commands whose output is noise (/compact) or that render in
      // their own panel (/doctor), but it silently swallows a review.
      if (REPORT_OUTPUT_COMMANDS.has(cmd) && event.content.trim()) {
        const reportMsg: ChatMessage = {
          id: `slash-report-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: event.content }],
          status: 'complete',
          createdAt: new Date().toISOString(),
          providerId: 'claude',
        }
        return { _pendingSlashCommand: '', messages: [...filtered, reportMsg] }
      }
      if (import.meta.env.DEV && import.meta.env.RENDERER_VITE_DEBUG_SLASH_OUTPUT === '1') {
        const debugText = `\`\`\`\n/${cmd}\n\n${event.content}\n\`\`\``
        const debugMsg: ChatMessage = {
          id: `slash-debug-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: debugText }],
          status: 'complete',
          createdAt: new Date().toISOString(),
          providerId: 'claude',
        }
        return { _pendingSlashCommand: '', messages: [...filtered, debugMsg] }
      }
      const hintMsg: ChatMessage = {
        id: `slash-hint-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `Command /${cmd} executed.` }],
        status: 'complete',
        createdAt: new Date().toISOString(),
        providerId: 'claude',
      }
      return {
        slashCommandOutput: { command: cmd, content: event.content },
        _pendingSlashCommand: '',
        messages: [...filtered, hintMsg],
      }
    }

    case 'checkpoint_captured': {
      const msgs = [...session.messages]
      let targetIdx = findCheckpointTarget(msgs, event.messageId)
      if (targetIdx === -1) return {}
      if (msgs[targetIdx].checkpointId) {
        const laterIdx = msgs.findLastIndex((m, i) => i > targetIdx && m.role === 'user' && !m.checkpointId)
        if (laterIdx !== -1) targetIdx = laterIdx
      }
      msgs[targetIdx] = { ...msgs[targetIdx], checkpointId: event.checkpointId, resumePointId: event.resumePointId }
      return { messages: msgs }
    }
  }
}
