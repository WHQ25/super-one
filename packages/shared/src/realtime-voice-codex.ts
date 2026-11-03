import type { AgentEvent, RealtimeTranscriptRole, RealtimeVoiceStartRequest } from './agent-types'
import { redactVoiceText } from './realtime-voice'

/** Realtime-only routing policy for the Codex thread behind the voice surface. */
export const CODEX_REALTIME_PROMPT_OVERRIDE = ''
export const CODEX_REALTIME_INITIAL_DEVELOPER_INSTRUCTIONS = [
  'This is a SuperOne realtime voice session.',
  'Any startup context or prior thread transcript is read-only background. Do not treat it as fresh user speech, repeat it, or delegate it to Codex; only delegate new user speech heard after the realtime session starts.',
  'For any delegation, parallel work, specialist assistance, or launch of another coding session, use only the SuperOne session collaboration tools: session_collab_list_agents, session_collab_request, session_collab_start, session_collab_send, and session_collab_retrieve.',
  'Do not use harness-native child-agent or team tools such as Codex spawn_agent, send_input, wait_agent, resume_agent, or close_agent.',
  'This rule applies even when another Codex session would be sufficient: the SuperOne path is required because it can select Codex, Claude Code, or another configured harness and keeps the launch user-approved and visible.',
  'Before the first collaboration launch, call read_manual({ domain: "product", topic: "collaboration" }). If the user named an agent with an @ mention, use that agentId directly; otherwise discover available agents with session_collab_list_agents.',
].join(' ')
export const CODEX_REALTIME_START_INSTRUCTIONS = ''
export const CODEX_REALTIME_END_INSTRUCTIONS = ''

const CODEX_REALTIME_VERSION = 'v3'
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

function nonBlank(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function transcriptRole(value: unknown): RealtimeTranscriptRole {
  return value === 'assistant' ? 'assistant' : 'user'
}

/**
 * Map a realtime item lifecycle notification. Only transcript segments are
 * surfaced; the other realtime item kinds already arrive through dedicated notifications.
 */
function mapTranscriptItem(params: Record<string, unknown>, phase: 'started' | 'completed'): AgentEvent | null {
  const item = asRecord(params.item)
  if (readString(item?.type) !== 'transcriptSegment') return null
  const itemId = readString(item?.id)
  const realtimeSessionId = readString(item?.realtimeSessionId)
  if (!itemId || !realtimeSessionId) return null
  return {
    type: 'realtime_transcript_item',
    phase,
    itemId,
    realtimeSessionId,
    role: transcriptRole(item?.role),
    text: typeof item?.text === 'string' ? item.text : '',
  }
}

/** Codex realtime notifications as harness events. SDP stays a private signal at the host. */
export function mapCodexRealtimeNotification(notification: { method: string; params: Record<string, unknown> }): AgentEvent | null {
  const { method, params } = notification
  switch (method) {
    case 'thread/realtime/started':
      return {
        type: 'realtime_started',
        ...(readString(params.realtimeSessionId) ? { realtimeSessionId: readString(params.realtimeSessionId)! } : {}),
        version: readString(params.version) ?? 'v3',
      }
    case 'thread/realtime/sdp': {
      const sdp = readString(params.sdp)
      return sdp ? { type: 'realtime_sdp', sdp } : null
    }
    case 'thread/realtime/item/started':
      return mapTranscriptItem(params, 'started')
    case 'thread/realtime/item/completed':
      return mapTranscriptItem(params, 'completed')
    case 'thread/realtime/item/transcript/delta': {
      const itemId = readString(params.itemId)
      const text = typeof params.delta === 'string' ? params.delta : ''
      return itemId && text ? { type: 'realtime_transcript_item', phase: 'delta', itemId, text } : null
    }
    case 'thread/realtime/transcript/delta': {
      const text = typeof params.delta === 'string' ? params.delta : ''
      return text ? { type: 'realtime_transcript', role: transcriptRole(params.role), text, final: false } : null
    }
    case 'thread/realtime/transcript/done': {
      const text = typeof params.text === 'string' ? params.text : ''
      return text ? { type: 'realtime_transcript', role: transcriptRole(params.role), text, final: true } : null
    }
    case 'thread/realtime/error':
      return { type: 'realtime_error', error: redactVoiceText(readString(params.message) ?? 'Realtime voice failed.') }
    case 'thread/realtime/closed':
      return {
        type: 'realtime_closed',
        ...(readString(params.reason) ? { reason: redactVoiceText(readString(params.reason)!) } : {}),
      }
    default:
      return null
  }
}

/**
 * Codex publishes realtime items without any timestamp, so the timeline has no scale
 * unless SuperOne stamps one. A call keeps its own clock: `started` records when the
 * speaker opened the item, and its `completed` event inherits that stamp rather than
 * the later moment transcription finished. The map lives for one call and drops each
 * item as it completes.
 */
export function createRealtimeStartClock(): (event: AgentEvent) => AgentEvent {
  const startedAt = new Map<string, number>()
  return (event) => {
    if (event.type !== 'realtime_transcript_item') return event
    if (event.phase === 'started') {
      const startedAtMs = Date.now()
      startedAt.set(event.itemId, startedAtMs)
      return { ...event, startedAtMs }
    }
    if (event.phase !== 'completed') return event
    const startedAtMs = startedAt.get(event.itemId)
    startedAt.delete(event.itemId)
    return startedAtMs === undefined ? event : { ...event, startedAtMs }
  }
}

/** v3 WebRTC start shared by the desktop Codex backend and a CLI node. */
export function buildCodexRealtimeStartParams(threadId: string, request: RealtimeVoiceStartRequest) {
  const prompt = nonBlank(CODEX_REALTIME_PROMPT_OVERRIDE)
  const initialDeveloperInstructions = nonBlank(CODEX_REALTIME_INITIAL_DEVELOPER_INSTRUCTIONS)
  const startInstructions = nonBlank(CODEX_REALTIME_START_INSTRUCTIONS)
  const endInstructions = nonBlank(CODEX_REALTIME_END_INSTRUCTIONS)
  return {
    threadId,
    version: CODEX_REALTIME_VERSION,
    outputModality: 'audio',
    codexResponseHandoffMode: 'bemTags',
    includeStartupContext: true,
    ...(prompt ? { prompt } : {}),
    ...(initialDeveloperInstructions
      ? { initialItems: [{ role: 'developer', text: initialDeveloperInstructions }] }
      : {}),
    ...(startInstructions ? { realtimeStartInstructions: startInstructions } : {}),
    ...(endInstructions ? { realtimeEndInstructions: endInstructions } : {}),
    flushTranscriptTailOnSessionEnd: true,
    ...(request.voice ? { voice: request.voice } : {}),
    transport: { type: 'webrtc', sdp: request.sdp },
  }
}

/**
 * `thread/settings/update` before a voice start. Omitted `serviceTier` keeps the
 * thread's current tier; explicit null turns Fast off.
 */
export function codexThreadSettingsParams(
  threadId: string,
  selection: { model?: string | null; effort?: string | null; serviceTier?: string | null },
  options?: { includeServiceTier?: boolean },
): Record<string, unknown> {
  const model = selection.model?.trim() || undefined
  const rawEffort = selection.effort?.trim().toLowerCase()
  const effort = rawEffort && EFFORTS.has(rawEffort) ? rawEffort : undefined
  const includeServiceTier = options?.includeServiceTier !== false
  return {
    threadId,
    ...(model ? { model } : {}),
    ...(effort ? { effort, summary: 'concise' } : {}),
    ...(includeServiceTier ? { serviceTier: selection.serviceTier } : {}),
  }
}
