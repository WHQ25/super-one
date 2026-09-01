import type {
  AgentEvent,
  ChatMessage,
  CodexRunResult,
  CodexRealtimeVoiceCatalog,
  CodexThreadItem,
  RealtimeTimelineResult,
  RealtimeTranscriptRole,
  RealtimeVoiceStartRequest,
} from '@superone/shared/agent-types'
import { isRealtimeDelegationText } from '@superone/shared/realtime-timeline'
import {
  CODEX_REALTIME_END_INSTRUCTIONS,
  CODEX_REALTIME_INITIAL_DEVELOPER_INSTRUCTIONS,
  CODEX_REALTIME_PROMPT_OVERRIDE,
  CODEX_REALTIME_START_INSTRUCTIONS,
} from '../agent/superone-system-prompt'
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
import {
  deriveFinalResponse,
  mapThreadItemFromAppServer,
  rejectPendingApprovals,
  streamTurnEvents,
  withThreadConnection,
  type CodexRunStreamCallbacks,
} from './codex-turn'

export interface CodexRealtimeHandle {
  readonly threadId: string
  stop(): Promise<void>
  closed: Promise<void>
  delegatedTurns: Promise<void>
}

export interface CodexRealtimeDelegatedTurnHandler {
  callbacks: CodexRunStreamCallbacks
  onCompleted(result: CodexRunResult): void
  onError(error: Error): void
}

const CODEX_REALTIME_VERSION = 'v3'

function nonBlankInstruction(value: string): string | undefined {
  return value.trim() ? value : undefined
}

export function buildCodexRealtimeStartParams(
  threadId: string,
  request: RealtimeVoiceStartRequest,
) {
  const prompt = nonBlankInstruction(CODEX_REALTIME_PROMPT_OVERRIDE)
  const initialDeveloperInstructions = nonBlankInstruction(CODEX_REALTIME_INITIAL_DEVELOPER_INSTRUCTIONS)
  const startInstructions = nonBlankInstruction(CODEX_REALTIME_START_INSTRUCTIONS)
  const endInstructions = nonBlankInstruction(CODEX_REALTIME_END_INSTRUCTIONS)
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

function mapTimelineRealtimeSegment(entry: unknown): RealtimeTimelineResult['segments'][number] | null {
  const record = asRecord(entry)
  if (readString(record?.type) !== 'realtime') return null
  const item = asRecord(record?.item)
  if (readString(item?.type) !== 'transcriptSegment') return null
  const id = readString(item?.id)
  const realtimeSessionId = readString(item?.realtimeSessionId)
  const text = typeof item?.text === 'string' ? item.text : ''
  if (!id || !realtimeSessionId || !text) return null
  return { id, realtimeSessionId, role: transcriptRole(item?.role), text }
}

/**
 * Map a realtime item lifecycle notification. Only transcript segments are
 * surfaced; the other realtime item kinds (session started/closed, promoted BEM
 * items) already arrive through dedicated notifications.
 */
function mapRealtimeTranscriptItem(
  params: Record<string, unknown>,
  phase: 'started' | 'completed',
): AgentEvent | null {
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
    // An item this connection never saw start stays unstamped: order is still known,
    // an invented start time would not be.
    return startedAtMs === undefined ? event : { ...event, startedAtMs }
  }
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
    case 'thread/realtime/item/started':
      return mapRealtimeTranscriptItem(params, 'started')
    case 'thread/realtime/item/completed':
      return mapRealtimeTranscriptItem(params, 'completed')
    case 'thread/realtime/item/transcript/delta': {
      const itemId = readString(params.itemId)
      const text = typeof params.delta === 'string' ? params.delta : ''
      return itemId && text
        ? { type: 'realtime_transcript_item', phase: 'delta', itemId, text }
        : null
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
    order: number
    status: ChatMessage['status']
    users: ChatMessage[]
    items: CodexThreadItem[]
  }>()
  const realtimeMessages: Array<{ position: number; order: number; messages: ChatMessage[] }> = []

  const turnFor = (turnId: string, position: number, order: number) => {
    const existing = turns.get(turnId)
    if (existing) {
      existing.position = Math.min(existing.position, position)
      existing.order = Math.min(existing.order, order)
      return existing
    }
    const created = { position, order, status: 'streaming' as const, users: [], items: [] }
    turns.set(turnId, created)
    return created
  }

  for (const [order, entry] of entries.entries()) {
    const record = asRecord(entry)
    const type = readString(record?.type)
    const position = typeof record?.position === 'number' ? record.position : Number.MAX_SAFE_INTEGER
    if (type === 'realtime') {
      const segment = mapTimelineRealtimeSegment(entry)
      if (!segment) continue
      realtimeMessages.push({
        position,
        order,
        messages: [{
          id: `codex-realtime-${segment.id}`,
          role: segment.role,
          status: 'complete',
          content: [{ type: 'text', text: segment.text }],
          createdAt: '',
          providerId: 'codex',
        }],
      })
      continue
    }

    const turnId = readString(record?.turnId)
    if (!record || !turnId || (type !== 'item' && type !== 'turnStarted' && type !== 'turnCompleted')) continue
    const turn = turnFor(turnId, position, order)

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
      if (isRealtimeDelegationText(text)) continue
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

  const positionedTurns = [...turns.entries()].map(([turnId, turn]) => {
    const messages = (() => {
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
    })()
    return {
      position: turn.position,
      order: turn.order,
      messages,
    }
  })

  return [...realtimeMessages, ...positionedTurns]
    .sort((left, right) => left.position - right.position || left.order - right.order)
    .flatMap(({ messages }) => messages)
}

export function mapCodexRealtimeTimeline(
  response: Record<string, unknown>,
  threadId: string | null = null,
): RealtimeTimelineResult {
  const entries = Array.isArray(response.data) ? response.data : []
  const hasTimeline = entries.some((entry) => readString(asRecord(entry)?.type) === 'realtime')
  // thread/timeline/list returns the newest entries first. Render and persist the
  // timeline chronologically so replacing the live transcript does not flip it.
  const chronologicalEntries = entries
    .map((entry, index) => {
      const position = asRecord(entry)?.position
      return { entry, index, position: typeof position === 'number' ? position : index }
    })
    .sort((left, right) => left.position - right.position || left.index - right.index)
    .map(({ entry }) => entry)
  const segments = chronologicalEntries
    .map(mapTimelineRealtimeSegment)
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
  return {
    segments,
    threadMessages: mapTimelineThreadMessages(chronologicalEntries, threadId),
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
  const stampStart = createRealtimeStartClock()
  try {
    while (true) {
      const notification = await inbox.next()
      const event = mapCodexRealtimeNotification(notification)
      if (event) emit(stampStart(event))
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

async function pumpRealtimeDelegatedTurns(
  connection: AppServerConnection,
  inbox: NotificationInbox,
  dispatcher: NotificationDispatcher,
  session: CodexSession,
  threadId: string,
  realtimeClosed: Promise<void>,
  handler: CodexRealtimeDelegatedTurnHandler,
): Promise<void> {
  const controller = new AbortController()
  let turnActive = false
  let realtimeEnded = false
  session.runningController = controller
  const callbacks: CodexRunStreamCallbacks = {
    ...handler.callbacks,
    onTurnStarted: (info) => {
      turnActive = true
      handler.callbacks.onTurnStarted?.(info)
    },
    onTurnCompleted: (info) => {
      turnActive = false
      handler.callbacks.onTurnCompleted?.(info)
    },
  }

  void realtimeClosed.then(() => {
    realtimeEnded = true
    // Realtime close and its final delegated turn can arrive in the same batch.
    // Give the dispatcher one task to route that turn before deciding the pump is idle.
    setTimeout(() => {
      if (!turnActive && callbacks.hasQueuedMessages?.() !== true) controller.abort()
    }, 0)
  })

  try {
    while (!controller.signal.aborted) {
      turnActive = false
      const streamed = await streamTurnEvents(connection, session, null, controller, callbacks, {
        notificationInbox: inbox,
      })
      handler.onCompleted({
        threadId: streamed.threadId,
        ...(streamed.turnId ? { turnId: streamed.turnId } : {}),
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        turnUsage: streamed.turnUsage,
        items: streamed.items,
      })
      if (realtimeEnded && callbacks.hasQueuedMessages?.() !== true) break
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      handler.onError(error instanceof Error ? error : new Error(String(error)))
    }
  } finally {
    dispatcher.unregisterRealtimeTurnInbox(threadId)
    session.activeTurnId = null
    session.steerFn = null
    session.interruptFn = null
    rejectPendingApprovals(session, 'Codex realtime turn interrupted')
    if (session.runningController === controller) session.runningController = null
  }
}

export async function startCodexRealtime(
  session: CodexSession,
  auth: CodexProjectAuth,
  projectPath: string,
  cwd: string,
  request: RealtimeVoiceStartRequest,
  emit: (event: AgentEvent) => void,
  delegatedTurnHandler: CodexRealtimeDelegatedTurnHandler,
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
      const turnInbox = dispatcher.registerRealtimeTurnInbox(threadId)
      const cancellation = { cancelled: false }
      const closed = pumpRealtime(inbox, dispatcher, threadId, emit, cancellation)
      const delegatedTurns = pumpRealtimeDelegatedTurns(
        connection,
        turnInbox,
        dispatcher,
        session,
        threadId,
        closed,
        delegatedTurnHandler,
      )
      try {
        await connection.request(
          'thread/realtime/start',
          buildCodexRealtimeStartParams(threadId, request),
        )
      } catch (error) {
        cancellation.cancelled = true
        dispatcher.unregisterRealtimeInbox(threadId)
        dispatcher.unregisterRealtimeTurnInbox(threadId)
        void closed
        void delegatedTurns
        throw error
      }
      return {
        threadId,
        closed,
        delegatedTurns,
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
    async ({ connection, threadId }) => listCodexRealtimeTimelinePages(connection.request, threadId),
  )
}

export async function listCodexRealtimeTimelinePages(
  request: AppServerConnection['request'],
  threadId: string,
): Promise<RealtimeTimelineResult> {
  const data: unknown[] = []
  const seenCursors = new Set<string>()
  let cursor: unknown = undefined
  let activeRealtimeSessionAtPageStart: unknown = null
  let firstPage = true

  do {
    const response = await request('thread/timeline/list', {
      threadId,
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    })
    if (firstPage) {
      activeRealtimeSessionAtPageStart = response.activeRealtimeSessionAtPageStart
      firstPage = false
    }
    if (Array.isArray(response.data)) data.push(...response.data)
    cursor = response.nextCursor ?? null
    if (cursor !== null) {
      const cursorKey = JSON.stringify(cursor)
      if (seenCursors.has(cursorKey)) throw new Error('Codex timeline returned a repeated cursor.')
      seenCursors.add(cursorKey)
    }
  } while (cursor !== null)

  return mapCodexRealtimeTimeline({ data, activeRealtimeSessionAtPageStart }, threadId)
}
