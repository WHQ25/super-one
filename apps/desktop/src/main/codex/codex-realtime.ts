import type {
  AgentEvent,
  RealtimeTimelineResult,
  RealtimeTranscriptRole,
  RealtimeVoiceStartRequest,
} from '@superone/shared/agent-types'
import { asRecord, readString, resolvePermissionProfile, type AppServerNotification, type CodexProjectAuth } from './app-server-connection'
import type { NotificationDispatcher, NotificationInbox } from './codex-notification-dispatcher'
import type { CodexSession } from './codex-session'
import { withThreadConnection } from './codex-turn'

export interface CodexRealtimeHandle {
  readonly threadId: string
  stop(): Promise<void>
  closed: Promise<void>
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

export function mapCodexRealtimeTimeline(response: Record<string, unknown>): RealtimeTimelineResult {
  const entries = Array.isArray(response.data) ? response.data : []
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
    activeRealtimeSessionId: readString(response.activeRealtimeSessionAtPageStart),
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
        await connection.request('thread/realtime/start', {
          threadId,
          outputModality: 'audio',
          includeStartupContext: true,
          flushTranscriptTailOnSessionEnd: true,
          codexResponseHandoffMode: 'bemTags',
          version: 'v3',
          voice: request.voice ?? 'cove',
          transport: { type: 'webrtc', sdp: request.sdp },
        })
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
  if (session.apiProviderId) return { segments: [], activeRealtimeSessionId: null }
  return withThreadConnection(
    session,
    auth,
    undefined,
    projectPath,
    cwd,
    resolvePermissionProfile(session.permissionPreset),
    async ({ connection, threadId }) => mapCodexRealtimeTimeline(await connection.request('thread/timeline/list', {
      threadId,
      limit: 200,
    })),
  )
}
