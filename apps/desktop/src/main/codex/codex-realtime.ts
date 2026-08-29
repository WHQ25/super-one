import type {
  AgentEvent,
  ChatMessage,
  CodexRealtimeVoiceCatalog,
  CodexThreadItem,
  RealtimeTimelineResult,
  RealtimeTranscriptRole,
  RealtimeVoiceStartRequest,
} from '@superone/shared/agent-types'
import {
  asRecord,
  readString,
  resolvePermissionProfile,
  type AppServerConnection,
  type AppServerNotification,
  type CodexProjectAuth,
} from './app-server-connection'
import type { NotificationDispatcher, NotificationInbox } from './codex-notification-dispatcher'
import type { CodexSession } from './codex-session'
import { deriveFinalResponse, mapThreadItemFromAppServer, withThreadConnection } from './codex-turn'

export interface CodexRealtimeHandle {
  readonly threadId: string
  stop(): Promise<void>
  closed: Promise<void>
}

const CODEX_REALTIME_VERSION = 'v3'

export function buildCodexRealtimeStartParams(
  threadId: string,
  request: RealtimeVoiceStartRequest,
) {
  return {
    threadId,
    version: CODEX_REALTIME_VERSION,
    outputModality: 'audio',
    codexResponseHandoffMode: 'bemTags',
    includeStartupContext: true,
    flushTranscriptTailOnSessionEnd: true,
    ...(request.voice ? { voice: request.voice } : {}),
    transport: { type: 'webrtc', sdp: request.sdp },
  }
}

function readVoiceList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((voice): voice is string => typeof voice === 'string' && voice.length > 0))]
}

/** Flatten Codex's protocol-versioned response to the v1 voice group used by v3. */
export function mapCodexRealtimeVoiceCatalog(response: Record<string, unknown>): CodexRealtimeVoiceCatalog {
  const voicesRecord = asRecord(response.voices)
  const voices = readVoiceList(voicesRecord?.v1)
  const defaultVoice = readString(voicesRecord?.defaultV1)
  if (voices.length === 0 || !defaultVoice || !voices.includes(defaultVoice)) {
    throw new Error('Codex returned an invalid realtime voice catalog.')
  }
  return { voices, defaultVoice }
}

export async function listCodexRealtimeVoices(
  request: AppServerConnection['request'],
): Promise<CodexRealtimeVoiceCatalog> {
  return mapCodexRealtimeVoiceCatalog(await request('thread/realtime/listVoices', {}))
}

function transcriptRole(value: unknown): RealtimeTranscriptRole {
  return value === 'assistant' ? 'assistant' : 'user'
}

export function mapCodexRealtimeNotification(notification: AppServerNotification): AgentEvent | null {
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
    case 'thread/realtime/transcript/delta': {
      const text = typeof params.delta === 'string' ? params.delta : ''
      return text ? { type: 'realtime_transcript', role: transcriptRole(params.role), text, final: false } : null
    }
    case 'thread/realtime/transcript/done': {
      const text = typeof params.text === 'string' ? params.text : ''
      return text ? { type: 'realtime_transcript', role: transcriptRole(params.role), text, final: true } : null
    }
    case 'thread/realtime/error':
      return { type: 'realtime_error', error: readString(params.message) ?? 'Realtime voice failed.' }
    case 'thread/realtime/closed':
      return {
        type: 'realtime_closed',
        ...(readString(params.reason) ? { reason: readString(params.reason)! } : {}),
      }
    default:
      return null
  }
}

function mapTimelineThreadMessages(entries: unknown[], threadId: string | null): ChatMessage[] {
  const turns = new Map<string, {
    position: number
    status: ChatMessage['status']
    users: ChatMessage[]
    items: CodexThreadItem[]
  }>()

  const turnFor = (turnId: string, position: number) => {
    const existing = turns.get(turnId)
    if (existing) {
      existing.position = Math.min(existing.position, position)
      return existing
    }
    const created = { position, status: 'streaming' as const, users: [], items: [] }
    turns.set(turnId, created)
    return created
  }

  for (const entry of entries) {
    const record = asRecord(entry)
    const type = readString(record?.type)
    const turnId = readString(record?.turnId)
    if (!record || !turnId || (type !== 'item' && type !== 'turnStarted' && type !== 'turnCompleted')) continue
    const position = typeof record.position === 'number' ? record.position : Number.MAX_SAFE_INTEGER
    const turn = turnFor(turnId, position)

    if (type === 'turnCompleted') {
      const status = readString(record.status)
      turn.status = status === 'failed' ? 'error' : status === 'interrupted' ? 'interrupted' : 'complete'
      continue
    }
    if (type !== 'item') continue

    const item = asRecord(record.item)
    if (readString(item?.type) === 'userMessage') {
      const id = readString(item?.clientId) ?? readString(item?.id)
      if (!id) continue
      const text = (Array.isArray(item?.content) ? item.content : [])
        .map((input) => {
          const inputRecord = asRecord(input)
          return readString(inputRecord?.type) === 'text' ? readString(inputRecord?.text) : null
        })
        .filter((part): part is string => part !== null)
        .join('\n')
      turn.users.push({
        id,
        role: 'user',
        status: 'complete',
        content: [{ type: 'text', text }],
        createdAt: '',
        providerId: 'codex',
      })
      continue
    }

    const mapped = mapThreadItemFromAppServer(item)
    if (mapped) turn.items.push(mapped)
  }

  return [...turns.entries()]
    .sort(([, left], [, right]) => left.position - right.position)
    .flatMap(([turnId, turn]) => {
      if (turn.items.length === 0) return turn.users
      const finalResponse = deriveFinalResponse(turn.items)
      const assistant: ChatMessage = {
        id: `codex-timeline-${turnId}`,
        role: 'assistant',
        status: turn.status,
        content: finalResponse ? [{ type: 'text', text: finalResponse }] : [],
        createdAt: '',
        providerId: 'codex',
        metadata: {
          codex: {
            threadId,
            turnId,
            usage: null,
            items: turn.items,
          },
        },
      }
      return [...turn.users, assistant]
    })
}

export function mapCodexRealtimeTimeline(
  response: Record<string, unknown>,
  threadId: string | null = null,
): RealtimeTimelineResult {
  const entries = Array.isArray(response.data) ? response.data : []
  const hasTimeline = entries.some((entry) => readString(asRecord(entry)?.type) === 'realtime')
  const segments = entries.flatMap((entry) => {
    const record = asRecord(entry)
    if (readString(record?.type) !== 'realtime') return []
    const item = asRecord(record?.item)
    if (readString(item?.type) !== 'transcriptSegment') return []
    const id = readString(item?.id)
    const realtimeSessionId = readString(item?.realtimeSessionId)
    const text = typeof item?.text === 'string' ? item.text : ''
    if (!id || !realtimeSessionId || !text) return []
    return [{
      id,
      realtimeSessionId,
      role: transcriptRole(item?.role),
      text,
    }]
  })
  return {
    segments,
    threadMessages: mapTimelineThreadMessages(entries, threadId),
    activeRealtimeSessionId: readString(response.activeRealtimeSessionAtPageStart),
    hasTimeline,
  }
}

async function pumpRealtime(
  inbox: NotificationInbox,
  dispatcher: NotificationDispatcher,
  threadId: string,
  emit: (event: AgentEvent) => void,
  cancellation: { cancelled: boolean },
): Promise<void> {
  try {
    while (true) {
      const notification = await inbox.next()
      const event = mapCodexRealtimeNotification(notification)
      if (event) emit(event)
      if (notification.method === 'thread/realtime/closed') return
    }
  } catch (error) {
    if (!cancellation.cancelled) {
      emit({ type: 'realtime_error', error: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    dispatcher.unregisterRealtimeInbox(threadId)
  }
}

export async function startCodexRealtime(
  session: CodexSession,
  auth: CodexProjectAuth,
  projectPath: string,
  cwd: string,
  request: RealtimeVoiceStartRequest,
  emit: (event: AgentEvent) => void,
): Promise<CodexRealtimeHandle> {
  if (session.apiProviderId) {
    throw new Error('Realtime voice currently supports the official Codex account only.')
  }
  return withThreadConnection(
    session,
    auth,
    undefined,
    projectPath,
    cwd,
    resolvePermissionProfile(session.permissionPreset),
    async ({ connection, threadId }) => {
      const dispatcher = session.notificationDispatcher
      if (!dispatcher) throw new Error('Codex notification dispatcher unavailable')
      const inbox = dispatcher.registerRealtimeInbox(threadId)
      const cancellation = { cancelled: false }
      const closed = pumpRealtime(inbox, dispatcher, threadId, emit, cancellation)
      try {
        await connection.request(
          'thread/realtime/start',
          buildCodexRealtimeStartParams(threadId, request),
        )
      } catch (error) {
        cancellation.cancelled = true
        dispatcher.unregisterRealtimeInbox(threadId)
        void closed
        throw error
      }
      return {
        threadId,
        closed,
        stop: async () => {
          await connection.request('thread/realtime/stop', { threadId })
        },
      }
    },
  )
}

export async function listCodexRealtimeTimeline(
  session: CodexSession,
  auth: CodexProjectAuth,
  projectPath: string,
  cwd: string,
): Promise<RealtimeTimelineResult> {
  if (session.apiProviderId) return { segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: false }
  return withThreadConnection(
    session,
    auth,
    undefined,
    projectPath,
    cwd,
    resolvePermissionProfile(session.permissionPreset),
    async ({ connection, threadId }) => mapCodexRealtimeTimeline(
      await connection.request('thread/timeline/list', { threadId, limit: 200 }),
      threadId,
    ),
  )
}
