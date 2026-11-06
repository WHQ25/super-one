import { randomUUID } from 'node:crypto'
import type { AgentEvent, SystemNoticeMeta } from '@superone/shared/agent-types'

type NoticeEvent = Extract<AgentEvent, { type: 'user_message_appended' }>

/** Process-scoped notices must survive result, idle and interrupt draining. */
export function mapClaudeSystemNotice(sys: Record<string, unknown>): NoticeEvent | null {
  let text: string
  let meta: SystemNoticeMeta
  if (sys.subtype === 'informational') {
    if (typeof sys.content !== 'string' || !sys.content.trim()) return null
    text = sys.content
    const level = sys.level
    meta = { source: 'Claude Code', level: level === 'info' || level === 'suggestion' || level === 'warning' ? level : 'notice' }
    if (typeof sys.tool_use_id === 'string') meta.details = { tool_use_id: sys.tool_use_id }
  } else if (sys.subtype === 'session_writes_lost') {
    const lost = stringArray(sys.lost)
    const transcriptSessionIds = stringArray(sys.transcript_session_ids)
    const code = typeof sys.error_code === 'string' ? sys.error_code : undefined
    const cause = code === 'ENOSPC' ? 'the disk is full' : code === 'EDQUOT' ? 'the disk quota is exhausted' : 'a storage write failed'
    const targets = lost.map(item => item === 'transcript' ? 'session transcripts' : item === 'global_config' ? 'Claude Code configuration' : item)
    text = `Could not save ${targets.join(' and ') || 'session data'} because ${cause}.`
      + (lost.includes('transcript') ? ' Resuming affected sessions may omit part of the conversation.' : '')
    meta = { source: 'Claude Code', kind: 'storage', level: 'warning', ...(code ? { code } : {}),
      details: { lost, ...(transcriptSessionIds.length ? { transcriptSessionIds } : {}) } }
  } else return null

  return { type: 'user_message_appended', message: {
    // Stable on replay; no turn message id is required for shutdown notices.
    id: `claude-notice-${String(sys.session_id ?? '')}-${typeof sys.uuid === 'string' ? sys.uuid : randomUUID()}`,
    role: 'assistant', providerId: 'system', status: 'complete',
    content: [{ type: 'text', text }], createdAt: new Date().toISOString(),
    metadata: { systemNotice: meta },
  } }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
