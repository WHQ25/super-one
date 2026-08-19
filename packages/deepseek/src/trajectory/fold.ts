/**
 * The trajectory fold: one forward pass over a dsh session log, held open so a
 * live session can be folded event by event instead of from the start.
 *
 * dsh's log is seq-contiguous and its happy order is already causal
 * (`turn/start` -> `request/header` -> `step/start` -> chunks ->
 * `assistant/message` -> `tool/call` -> `tool/result` -> `step/end` ->
 * `turn/end`), so the pass stays linear with a little open-bracket state.
 * Nothing is inferred from wall-clock ordering; every association comes from an
 * explicit id (`callId`, approval `id`) or an open bracket.
 *
 * Holding that state open is what makes the panel affordable on a long session:
 * a streaming turn appends events continuously, and re-folding the whole log
 * per poll would cost the entire history every time. The fold instead consumes
 * only what is new and reports what that changed — including records it
 * *revised*, because a `tool/result` completes a call opened thousands of
 * events earlier.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
// Side-effect type imports: dsh merges each plugin's event vocabulary into
// `SessionEventMap` from the plugin's own package, so a consumer that reads an
// event has to name that package itself. Relying on some other file's runtime
// import to carry the augmentation is how `compaction/*` silently vanished from
// the union when the engine moved to the preset plane.
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ContentBlock, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { diffHeaders, projectHeader } from './header'
import { blocksText, blocksTextOfType, boundPayload, projectBlocks, summarize } from './payload'
import type {
  TrajectoryDelta,
  TrajectoryHeader,
  TrajectoryPage,
  TrajectoryPayload,
  TrajectoryProjection,
  TrajectoryRecord,
  TrajectoryRequest,
  TrajectorySchema,
  TrajectoryTurn,
  TrajectoryUsage,
} from '@superone/shared/trajectory-types'

/**
 * How many ledger records one window ships.
 *
 * The tail is what a user inspects first; earlier pages are fetched on demand
 * from the same open fold, so this bounds a single transfer rather than the
 * history a user can reach.
 */
export const RECORD_WINDOW = 2000

/**
 * How much untruncated text the fold retains for on-demand inspection.
 *
 * Only payloads the transport bound actually shortened are retained, so an
 * ordinary session retains nothing. The cap exists for the pathological case —
 * a session that reads a hundred large files — where keeping every full result
 * would trade a diagnostic panel for the app's memory.
 */
const OVERFLOW_MAX_CHARS = 64_000_000

/** Zero accounting, so totals can accumulate without null checks. */
function emptyUsage(): TrajectoryUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

/**
 * Project dsh token accounting, normalizing the optional cache counts to zero.
 * @param usage - the adapter-reported usage, absent when it reported none.
 * @returns the projected usage, or `null` when nothing was reported.
 */
function projectUsage(usage: TokenUsage | undefined): TrajectoryUsage | null {
  if (usage === undefined) return null
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
  }
}

/**
 * Whether a stream chunk carries actual generated content.
 *
 * TTFT is measured to the first chunk a user could have seen, so structural
 * frames (`block-start`, `usage`, `finish`) and empty deltas do not start the
 * clock.
 * @param chunk - the raw stream chunk.
 * @returns whether it delivered a non-empty delta.
 */
function chunkHasToken(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text.length > 0
  if (chunk.type === 'tool-call-delta') return chunk.argumentsDelta.length > 0
  return false
}

/**
 * `Omit` over a discriminated union, applied per member.
 *
 * The plain `Omit<TrajectoryRecord, 'index'>` collapses the union into its
 * common keys, which would reject every kind-specific field at the call site.
 */
type RecordDraft = TrajectoryRecord extends infer T
  ? T extends TrajectoryRecord ? Omit<T, 'index'> : never
  : never

/** An open model step, carrying the facts a finished message needs. */
interface OpenStep {
  turn: number
  step: number
  startedAt: number
  firstTokenTime: number | null
  request: number
}

/** An open compaction bracket. */
interface OpenCompaction {
  recordIndex: number
  request: number
}

/**
 * Summarize a header snapshot for its ledger row.
 * @param header - the projected header.
 * @param changed - whether it superseded an earlier snapshot.
 * @returns the one-line summary.
 */
function summarizeHeader(header: TrajectoryHeader, changed: boolean): string {
  const label = changed ? 'prompt updated' : 'prompt'
  return `${label} · ${header.config.model} · ${header.tools.length} tools`
}

/** One session's fold, held open across polls. */
export class TrajectoryFold {
  private readonly headers: TrajectoryHeader[] = []
  private readonly records: TrajectoryRecord[] = []
  private readonly requests: TrajectoryRequest[] = []
  private readonly turns: TrajectoryTurn[] = []
  private readonly totals = emptyUsage()

  /** Untruncated text for payloads the transport bound shortened. */
  private readonly overflow = new Map<string, string>()
  private overflowChars = 0

  /** How many source events have been folded — the caller's delta cursor. */
  private consumed = 0

  // Open brackets, carried across `consume` calls so a streaming turn folds
  // incrementally rather than restarting from the log's first event.
  private rawHeader: EpochHeader | null = null
  private header: TrajectoryHeader | null = null
  private openTurn: TrajectoryTurn | null = null
  private openStep: OpenStep | null = null
  private openRequest: TrajectoryRequest | null = null
  private openCompaction: OpenCompaction | null = null
  private route: TrajectoryRequest['route'] = null
  private readonly openTools = new Map<string, number>()
  private readonly openApprovals = new Map<string, number>()

  // Revision tracking: for each projected entity, the cursor value at which it
  // was last created or revised.
  //
  // Stamps rather than a drainable "changed since last poll" set, because two
  // panels can watch one session: a set would let whichever polled first
  // consume the other's delta. A stamp makes `delta()` a pure query of the
  // caller's own cursor, so every consumer sees every change exactly once.
  private readonly recordTouched: number[] = []
  private readonly requestTouched: number[] = []
  private readonly turnTouched: number[] = []
  private readonly headerTouched: number[] = []

  constructor(readonly sessionId: string) {}

  /** How many source events this fold has consumed. */
  get cursor(): number {
    return this.consumed
  }

  /** How many records the fold holds. */
  get size(): number {
    return this.records.length
  }

  /**
   * Fold one batch of events onto the open state.
   * @param events - the events after {@link cursor}, in seq order.
   */
  consume(events: readonly SessionEvent[]): void {
    for (const event of events) {
      // Advance first: a touch recorded inside `step` then stamps the cursor a
      // consumer must already be past to have seen it.
      this.consumed += 1
      this.step(event)
    }
  }

  /**
   * The loaded window a fresh consumer starts from: the tail, plus where that
   * tail sits in the fold.
   * @param live - whether the source session is still running.
   * @param window - how many records the window holds.
   * @returns the projection.
   */
  snapshot(live: boolean, window = RECORD_WINDOW): TrajectoryProjection {
    const start = Math.max(0, this.records.length - window)
    return {
      sessionId: this.sessionId,
      headers: [...this.headers],
      records: this.records.slice(start),
      requests: [...this.requests],
      turns: [...this.turns],
      totals: { ...this.totals },
      firstIndex: start + 1,
      total: this.records.length,
      cursor: this.consumed,
      live,
    }
  }

  /**
   * What changed since a consumer's cursor.
   * @param cursor - the consumer's last known cursor.
   * @param live - whether the source session is still running.
   * @returns the delta, addressed by stable ids the consumer merges by.
   */
  delta(cursor: number, live: boolean): TrajectoryDelta {
    const since = <T>(items: readonly T[], touched: readonly number[]): T[] =>
      items.filter((_, index) => (touched[index] ?? 0) > cursor)

    return {
      cursor: this.consumed,
      records: since(this.records, this.recordTouched),
      headers: since(this.headers, this.headerTouched),
      requests: since(this.requests, this.requestTouched),
      turns: since(this.turns, this.turnTouched),
      totals: { ...this.totals },
      total: this.records.length,
      live,
    }
  }

  /**
   * One page of records older than a loaded window.
   * @param before - the `index` of the consumer's first loaded record.
   * @param count - how many records to return.
   * @returns the page, empty when the window already reaches the fold's start.
   */
  page(before: number, count: number): TrajectoryPage {
    const end = Math.max(0, Math.min(before - 1, this.records.length))
    const start = Math.max(0, end - count)
    return { records: this.records.slice(start, end), firstIndex: start + 1 }
  }

  /**
   * The untruncated text behind one bounded payload.
   * @param recordId - the owning record's stable id.
   * @param field - the payload's field name.
   * @returns the full text, or `null` when the fold did not retain it.
   */
  payload(recordId: string, field: string): string | null {
    return this.overflow.get(`${recordId} ${field}`) ?? null
  }

  /**
   * Bound one text for transport, retaining the remainder for on-demand reads.
   * @param recordId - the owning record's stable id.
   * @param field - the payload's field name.
   * @param text - the complete text.
   * @returns the bounded payload.
   */
  private bind(recordId: string, field: string, text: string): TrajectoryPayload {
    const payload = boundPayload(text)
    if (payload.truncatedChars !== undefined && this.overflowChars + text.length <= OVERFLOW_MAX_CHARS) {
      this.overflow.set(`${recordId} ${field}`, text)
      this.overflowChars += text.length
    }
    return payload
  }

  /** Look up a tool's advertised schema in the catalog in force right now. */
  private schemaFor(name: string): TrajectorySchema | null {
    return this.header?.tools.find((tool) => tool.name === name) ?? null
  }

  /** Append a record, assigning its ledger position. */
  private push(record: RecordDraft): number {
    const index = this.records.length
    this.records.push({ ...record, index: index + 1 } as TrajectoryRecord)
    this.recordTouched[index] = this.consumed
    return index
  }

  /** Stamp one record as changed at the current cursor. */
  private touchRecord(index: number): void {
    this.recordTouched[index] = this.consumed
  }

  /** Stamp one request as changed at the current cursor. */
  private touchRequest(ordinal: number): void {
    this.requestTouched[ordinal - 1] = this.consumed
  }

  /** Stamp one turn as changed at the current cursor. */
  private touchTurn(index: number): void {
    this.turnTouched[index] = this.consumed
  }

  /** Open a request, numbered across ordinary generation and compaction alike. */
  private openNewRequest(
    purpose: TrajectoryRequest['purpose'],
    seq: number,
    time: number,
    turn: number | null,
    step: number | null,
  ): TrajectoryRequest {
    const request: TrajectoryRequest = {
      ordinal: this.requests.length + 1,
      seq,
      purpose,
      turn,
      step,
      startedAt: time,
      durationMs: null,
      ttftMs: null,
      usage: null,
      route: this.route,
      header: this.header?.index ?? null,
    }
    this.requests.push(request)
    this.touchRequest(request.ordinal)
    return request
  }

  /** Fold one event onto the open state. */
  private step(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start': {
        this.openTurn = {
          turn: event.data.turn,
          startedAt: event.time,
          durationMs: null,
          outcome: null,
          steps: 0,
          toolCalls: 0,
        }
        this.turns.push(this.openTurn)
        this.touchTurn(this.turns.length - 1)
        break
      }

      case 'turn/end': {
        const index = this.turns.findLastIndex((candidate) => candidate.turn === event.data.turn)
        const turn = index === -1 ? undefined : this.turns[index]
        if (turn) {
          turn.durationMs = event.time - turn.startedAt
          turn.outcome = event.data.reason.kind
          this.touchTurn(index)
        }
        this.openTurn = null
        break
      }

      case 'request/header': {
        const next = projectHeader(
          event.data.header,
          this.headers.length,
          event.seq,
          event.time,
          event.data.reason,
        )
        const change = diffHeaders(this.rawHeader, event.data.header)
        if (next.system !== null) next.system = this.bind(`header:${next.index}`, 'system', next.system.text)
        this.headerTouched[this.headers.length] = this.consumed
        this.headers.push(next)
        // dsh appends the snapshot INSIDE the step it applies to, after
        // `step/start` and before dispatch. So the open request adopts it here;
        // reading the header at `step/start` would always see the previous one.
        if (this.openRequest) {
          this.openRequest.header = next.index
          this.touchRequest(this.openRequest.ordinal)
        }
        this.push({
          id: `system:${event.seq}`,
          kind: 'system',
          seq: event.seq,
          turn: this.openTurn?.turn ?? null,
          step: this.openStep?.step ?? null,
          request: this.openRequest?.ordinal ?? null,
          startedAt: event.time,
          durationMs: null,
          summary: summarizeHeader(next, change !== null),
          header: next.index,
          change,
        })
        this.header = next
        this.rawHeader = event.data.header
        break
      }

      case 'request/context': {
        this.route = {
          provider: event.data.provider,
          model: event.data.model,
          contextWindow: event.data.contextWindow ?? null,
        }
        if (this.openRequest) {
          this.openRequest.route = this.route
          this.touchRequest(this.openRequest.ordinal)
        }
        break
      }

      case 'step/start': {
        this.openRequest = this.openNewRequest(
          'generation',
          event.seq,
          event.time,
          event.data.turn,
          event.data.step,
        )
        this.openStep = {
          turn: event.data.turn,
          step: event.data.step,
          startedAt: event.time,
          firstTokenTime: null,
          request: this.openRequest.ordinal,
        }
        if (this.openTurn) {
          this.openTurn.steps += 1
          this.touchTurn(this.turns.length - 1)
        }
        break
      }

      case 'assistant/chunk': {
        const step = this.openStep
        if (step && step.firstTokenTime === null && chunkHasToken(event.data.chunk)) {
          step.firstTokenTime = event.time
        }
        break
      }

      case 'assistant/message': {
        const blocks = event.data.message.content
        const startedAt = this.openStep?.startedAt ?? event.time
        const firstToken = this.openStep?.firstTokenTime ?? null
        const ttftMs = firstToken === null ? null : firstToken - startedAt
        const usage = projectUsage(event.data.usage)
        if (usage) {
          this.totals.input += usage.input
          this.totals.output += usage.output
          this.totals.cacheRead += usage.cacheRead
          this.totals.cacheWrite += usage.cacheWrite
          this.totals.reasoning += usage.reasoning
        }
        const text = blocksTextOfType(blocks, 'text')
        const thinking = blocksTextOfType(blocks, 'reasoning')
        const id = `message:${event.seq}`
        this.push({
          id,
          kind: 'message',
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          request: this.openStep?.request ?? null,
          startedAt,
          durationMs: event.time - startedAt,
          summary: summarize(text.length > 0 ? text : blocksText(blocks)),
          text: this.bind(id, 'text', text),
          thinking: thinking.length > 0 ? this.bind(id, 'thinking', thinking) : null,
          blocks: projectBlocks(blocks),
          provider: event.data.message.source.provider,
          model: event.data.message.source.model,
          usage,
          ttftMs,
        })
        if (this.openRequest) {
          this.openRequest.usage = usage
          this.openRequest.ttftMs = ttftMs
          this.touchRequest(this.openRequest.ordinal)
        }
        break
      }

      case 'step/end': {
        if (this.openRequest) {
          this.openRequest.durationMs = event.time - this.openRequest.startedAt
          this.touchRequest(this.openRequest.ordinal)
        }
        this.openRequest = null
        this.openStep = null
        break
      }

      case 'user/message': {
        // A compaction's surface replacement rides a `user/message` whose
        // `surfaceOp` shadows the compacted range. The `compacted` record
        // already stands for that transaction, so projecting the replacement
        // separately would show the same event twice.
        if (typeof event.surfaceOp === 'object') break
        const blocks = event.data.content
        const text = blocksText(blocks)
        const source = event.data.source
        if (source.kind === 'user') {
          const id = `user:${event.seq}`
          this.push({
            id,
            kind: 'user',
            seq: event.seq,
            turn: this.openTurn?.turn ?? null,
            step: null,
            request: null,
            startedAt: event.time,
            durationMs: null,
            summary: summarize(text),
            content: this.bind(id, 'content', text),
            blocks: projectBlocks(blocks),
          })
          break
        }
        const plugin = source.kind === 'plugin' ? source.plugin : source.kind
        const form = source.kind === 'plugin' && 'form' in source ? source.form ?? null : null
        const notice = source.kind === 'plugin' && 'summary' in source ? source.summary : null
        const sections = source.kind === 'plugin' && 'sections' in source
          ? source.sections.map((section) => ({ name: section.name, text: section.text }))
          : null
        const id = `context:${event.seq}`
        this.push({
          id,
          kind: 'context',
          seq: event.seq,
          turn: this.openTurn?.turn ?? null,
          step: null,
          request: null,
          startedAt: event.time,
          durationMs: null,
          summary: summarize(notice ?? text),
          content: this.bind(id, 'content', text),
          blocks: projectBlocks(blocks),
          producer: plugin,
          form,
          notice: notice ?? null,
          sections,
        })
        break
      }

      case 'tool/call': {
        const id = `tool:${event.data.callId}`
        const index = this.push({
          id,
          kind: 'tool',
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          request: this.openStep?.request ?? null,
          startedAt: event.time,
          durationMs: null,
          summary: `${event.data.name} ${summarize(event.data.arguments)}`.trim(),
          name: event.data.name,
          callId: event.data.callId,
          args: this.bind(id, 'args', event.data.arguments),
          result: null,
          schema: this.schemaFor(event.data.name),
          isError: false,
          error: null,
        })
        this.openTools.set(event.data.callId, index)
        if (this.openTurn) {
          this.openTurn.toolCalls += 1
          this.touchTurn(this.turns.length - 1)
        }
        break
      }

      case 'tool/result': {
        const callId = event.data.message.source.callId
        const index = this.openTools.get(callId)
        if (index === undefined) break
        this.openTools.delete(callId)
        const record = this.records[index]
        if (record?.kind !== 'tool') break
        const block: ContentBlock = event.data.message.content[0]
        const text = blocksText(block.type === 'tool-result' ? block.content : [block])
        record.result = this.bind(record.id, 'result', text)
        record.durationMs = event.time - record.startedAt
        record.isError = block.type === 'tool-result' && block.isError === true
        record.error = event.data.error ?? null
        this.touchRecord(index)
        break
      }

      case 'compaction/start': {
        const request = this.openNewRequest('compaction', event.seq, event.time, event.data.turn, null)
        const index = this.push({
          id: `compacted:${event.seq}`,
          kind: 'compacted',
          seq: event.seq,
          // dsh marks a standalone manual transaction with `turn: null`; a
          // numbered owner means the pressure listener fired inside a turn.
          turn: event.data.turn,
          step: null,
          request: request.ordinal,
          startedAt: event.time,
          durationMs: null,
          summary: event.data.turn === null ? 'compaction (manual)' : 'compaction (auto)',
          trigger: event.data.turn === null ? 'manual' : 'auto',
          preTokens: null,
          postTokens: null,
          compactionSummary: null,
        })
        this.openCompaction = { recordIndex: index, request: request.ordinal }
        break
      }

      case 'compaction/summary': {
        const open = this.openCompaction
        if (!open) break
        const record = this.records[open.recordIndex]
        if (record?.kind !== 'compacted') break
        const text = blocksText(event.data.summary)
        record.preTokens = event.data.shadowedTokenCount
        record.postTokens = event.data.usage?.outputTokens ?? null
        record.compactionSummary = this.bind(record.id, 'summary', text)
        record.summary = `${record.summary} — ${summarize(text)}`
        this.touchRecord(open.recordIndex)
        const request = this.requests[open.request - 1]
        if (request) {
          request.usage = projectUsage(event.data.usage)
          request.route = { provider: event.data.provider, model: event.data.model, contextWindow: null }
          this.touchRequest(request.ordinal)
        }
        break
      }

      case 'compaction/end': {
        const open = this.openCompaction
        if (!open) break
        const record = this.records[open.recordIndex]
        if (record?.kind === 'compacted') {
          record.durationMs = event.time - record.startedAt
          this.touchRecord(open.recordIndex)
        }
        const request = this.requests[open.request - 1]
        if (request) {
          request.durationMs = event.time - request.startedAt
          this.touchRequest(request.ordinal)
        }
        this.openCompaction = null
        break
      }

      case 'agent-preset/selected': {
        // The composition changed while the session was still blank. The
        // `request/header` that follows carries the resulting prompt and tool
        // diff; this record is the reason that diff exists.
        this.push({
          id: `preset:${event.seq}`,
          kind: 'preset',
          seq: event.seq,
          turn: this.openTurn?.turn ?? null,
          step: null,
          request: null,
          startedAt: event.time,
          durationMs: null,
          summary: `preset -> ${event.data.agentPreset}`,
          preset: event.data.agentPreset,
        })
        break
      }

      case 'approval/asked': {
        const index = this.push({
          id: `approval:${event.data.id}`,
          kind: 'approval',
          seq: event.seq,
          turn: this.openTurn?.turn ?? null,
          step: this.openStep?.step ?? null,
          request: this.openStep?.request ?? null,
          startedAt: event.time,
          durationMs: null,
          summary: `approval: ${event.data.toolName}`,
          toolName: event.data.toolName,
          callId: event.data.callId ?? null,
          reason: event.data.reason ?? null,
          outcome: null,
        })
        this.openApprovals.set(event.data.id, index)
        break
      }

      case 'approval/decided': {
        const index = this.openApprovals.get(event.data.id)
        if (index === undefined) break
        this.openApprovals.delete(event.data.id)
        const record = this.records[index]
        if (record?.kind !== 'approval') break
        record.outcome = event.data.outcome
        record.durationMs = event.time - record.startedAt
        record.summary = `approval: ${record.toolName} -> ${event.data.outcome}`
        this.touchRecord(index)
        break
      }

      default:
        break
    }
  }
}
