/**
 * The trajectory fold: one pass over a dsh session log producing the ledger,
 * the request projection, and the turn boundaries.
 *
 * dsh's log is seq-contiguous and its happy order is already causal
 * (`turn/start` → `request/header` → `step/start` → chunks → `assistant/message`
 * → `tool/call` → `tool/result` → `step/end` → `turn/end`), so this stays a
 * single forward pass with a little open-bracket state. Nothing is inferred
 * from wall-clock ordering; every association comes from an explicit id
 * (`callId`, approval `id`) or an open bracket.
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
  TrajectoryHeader,
  TrajectoryProjection,
  TrajectoryRecord,
  TrajectoryRequest,
  TrajectorySchema,
  TrajectoryTurn,
  TrajectoryUsage,
} from '@superone/shared/trajectory-types'

/**
 * How many ledger records the projection ships.
 *
 * The tail is what a user inspects; an older prefix is reachable once backward
 * paging lands. Turns, requests, and headers are small and stay complete, so a
 * dropped record still resolves its request ordinal and header.
 */
export const RECORD_WINDOW = 2000

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
 * Fold a dsh session log into the trajectory wire model.
 * @param sessionId - the session the log belongs to.
 * @param events - the log in seq order.
 * @param live - whether the source session is still running.
 * @returns the projection, with its ledger bounded to {@link RECORD_WINDOW}.
 */
export function projectTrajectory(
  sessionId: string,
  events: readonly SessionEvent[],
  live: boolean,
): TrajectoryProjection {
  const headers: TrajectoryHeader[] = []
  const records: TrajectoryRecord[] = []
  const requests: TrajectoryRequest[] = []
  const turns: TrajectoryTurn[] = []
  const totals = emptyUsage()

  let rawHeader: EpochHeader | null = null
  let header: TrajectoryHeader | null = null
  let openTurn: TrajectoryTurn | null = null
  let openStep: OpenStep | null = null
  let openRequest: TrajectoryRequest | null = null
  let openCompaction: OpenCompaction | null = null
  let route: TrajectoryRequest['route'] = null
  const openTools = new Map<string, number>()
  const openApprovals = new Map<string, number>()

  /** Look up a tool's advertised schema in the catalog in force right now. */
  const schemaFor = (name: string): TrajectorySchema | null =>
    header?.tools.find((tool) => tool.name === name) ?? null

  /** Append a record, assigning its ledger position. */
  const push = (record: RecordDraft): number => {
    const index = records.length
    records.push({ ...record, index: index + 1 } as TrajectoryRecord)
    return index
  }

  /** Open a request, numbered across ordinary generation and compaction alike. */
  const openNewRequest = (
    purpose: TrajectoryRequest['purpose'],
    seq: number,
    time: number,
    turn: number | null,
    step: number | null,
  ): TrajectoryRequest => {
    const request: TrajectoryRequest = {
      ordinal: requests.length + 1,
      seq,
      purpose,
      turn,
      step,
      startedAt: time,
      durationMs: null,
      ttftMs: null,
      usage: null,
      route,
      header: header?.index ?? null,
    }
    requests.push(request)
    return request
  }

  for (const event of events) {
    switch (event.type) {
      case 'turn/start': {
        openTurn = {
          turn: event.data.turn,
          startedAt: event.time,
          durationMs: null,
          outcome: null,
          steps: 0,
          toolCalls: 0,
        }
        turns.push(openTurn)
        break
      }

      case 'turn/end': {
        const turn = turns.findLast((candidate) => candidate.turn === event.data.turn)
        if (turn) {
          turn.durationMs = event.time - turn.startedAt
          turn.outcome = event.data.reason.kind
        }
        openTurn = null
        break
      }

      case 'request/header': {
        const next = projectHeader(event.data.header, headers.length, event.seq, event.time, event.data.reason)
        const change = diffHeaders(rawHeader, event.data.header)
        headers.push(next)
        // dsh appends the snapshot INSIDE the step it applies to, after
        // `step/start` and before dispatch. So the open request adopts it here;
        // reading the header at `step/start` would always see the previous one.
        if (openRequest) openRequest.header = next.index
        push({
          id: `system:${event.seq}`,
          kind: 'system',
          seq: event.seq,
          turn: openTurn?.turn ?? null,
          step: openStep?.step ?? null,
          request: openRequest?.ordinal ?? null,
          startedAt: event.time,
          durationMs: null,
          summary: summarizeHeader(next, change !== null),
          header: next.index,
          change,
        })
        header = next
        rawHeader = event.data.header
        break
      }

      case 'request/context': {
        route = {
          provider: event.data.provider,
          model: event.data.model,
          contextWindow: event.data.contextWindow ?? null,
        }
        if (openRequest) openRequest.route = route
        break
      }

      case 'step/start': {
        openRequest = openNewRequest('generation', event.seq, event.time, event.data.turn, event.data.step)
        openStep = {
          turn: event.data.turn,
          step: event.data.step,
          startedAt: event.time,
          firstTokenTime: null,
          request: openRequest.ordinal,
        }
        if (openTurn) openTurn.steps += 1
        break
      }

      case 'assistant/chunk': {
        if (openStep && openStep.firstTokenTime === null && chunkHasToken(event.data.chunk)) {
          openStep.firstTokenTime = event.time
        }
        break
      }

      case 'assistant/message': {
        const blocks = event.data.message.content
        const startedAt = openStep?.startedAt ?? event.time
        const firstToken = openStep?.firstTokenTime ?? null
        const ttftMs = firstToken === null ? null : firstToken - startedAt
        const usage = projectUsage(event.data.usage)
        if (usage) {
          totals.input += usage.input
          totals.output += usage.output
          totals.cacheRead += usage.cacheRead
          totals.cacheWrite += usage.cacheWrite
          totals.reasoning += usage.reasoning
        }
        const text = blocksTextOfType(blocks, 'text')
        const thinking = blocksTextOfType(blocks, 'reasoning')
        push({
          id: `message:${event.seq}`,
          kind: 'message',
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          request: openStep?.request ?? null,
          startedAt,
          durationMs: event.time - startedAt,
          summary: summarize(text.length > 0 ? text : blocksText(blocks)),
          text: boundPayload(text),
          thinking: thinking.length > 0 ? boundPayload(thinking) : null,
          blocks: projectBlocks(blocks),
          provider: event.data.message.source.provider,
          model: event.data.message.source.model,
          usage,
          ttftMs,
        })
        if (openRequest) {
          openRequest.usage = usage
          openRequest.ttftMs = ttftMs
        }
        break
      }

      case 'step/end': {
        if (openRequest) openRequest.durationMs = event.time - openRequest.startedAt
        openRequest = null
        openStep = null
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
          push({
            id: `user:${event.seq}`,
            kind: 'user',
            seq: event.seq,
            turn: openTurn?.turn ?? null,
            step: null,
            request: null,
            startedAt: event.time,
            durationMs: null,
            summary: summarize(text),
            content: boundPayload(text),
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
        push({
          id: `context:${event.seq}`,
          kind: 'context',
          seq: event.seq,
          turn: openTurn?.turn ?? null,
          step: null,
          request: null,
          startedAt: event.time,
          durationMs: null,
          summary: summarize(notice ?? text),
          content: boundPayload(text),
          blocks: projectBlocks(blocks),
          producer: plugin,
          form,
          notice: notice ?? null,
          sections,
        })
        break
      }

      case 'tool/call': {
        const index = push({
          id: `tool:${event.data.callId}`,
          kind: 'tool',
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          request: openStep?.request ?? null,
          startedAt: event.time,
          durationMs: null,
          summary: `${event.data.name} ${summarize(event.data.arguments)}`.trim(),
          name: event.data.name,
          callId: event.data.callId,
          args: boundPayload(event.data.arguments),
          result: null,
          schema: schemaFor(event.data.name),
          isError: false,
          error: null,
        })
        openTools.set(event.data.callId, index)
        if (openTurn) openTurn.toolCalls += 1
        break
      }

      case 'tool/result': {
        const callId = event.data.message.source.callId
        const index = openTools.get(callId)
        if (index === undefined) break
        openTools.delete(callId)
        const record = records[index]
        if (record?.kind !== 'tool') break
        const block: ContentBlock = event.data.message.content[0]
        const text = blocksText(block.type === 'tool-result' ? block.content : [block])
        record.result = boundPayload(text)
        record.durationMs = event.time - record.startedAt
        record.isError = block.type === 'tool-result' && block.isError === true
        record.error = event.data.error ?? null
        break
      }

      case 'compaction/start': {
        const request = openNewRequest('compaction', event.seq, event.time, event.data.turn, null)
        const index = push({
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
        openCompaction = { recordIndex: index, request: request.ordinal }
        break
      }

      case 'compaction/summary': {
        if (!openCompaction) break
        const record = records[openCompaction.recordIndex]
        if (record?.kind !== 'compacted') break
        const text = blocksText(event.data.summary)
        record.preTokens = event.data.shadowedTokenCount
        record.postTokens = event.data.usage?.outputTokens ?? null
        record.compactionSummary = boundPayload(text)
        record.summary = `${record.summary} — ${summarize(text)}`
        const request = requests[openCompaction.request - 1]
        if (request) {
          request.usage = projectUsage(event.data.usage)
          request.route = { provider: event.data.provider, model: event.data.model, contextWindow: null }
        }
        break
      }

      case 'compaction/end': {
        if (!openCompaction) break
        const record = records[openCompaction.recordIndex]
        if (record?.kind === 'compacted') record.durationMs = event.time - record.startedAt
        const request = requests[openCompaction.request - 1]
        if (request) request.durationMs = event.time - request.startedAt
        openCompaction = null
        break
      }

      case 'agent-preset/selected': {
        // The composition changed while the session was still blank. The
        // `request/header` that follows carries the resulting prompt and tool
        // diff; this record is the reason that diff exists.
        push({
          id: `preset:${event.seq}`,
          kind: 'preset',
          seq: event.seq,
          turn: openTurn?.turn ?? null,
          step: null,
          request: null,
          startedAt: event.time,
          durationMs: null,
          summary: `preset → ${event.data.agentPreset}`,
          preset: event.data.agentPreset,
        })
        break
      }

      case 'approval/asked': {
        const index = push({
          id: `approval:${event.data.id}`,
          kind: 'approval',
          seq: event.seq,
          turn: openTurn?.turn ?? null,
          step: openStep?.step ?? null,
          request: openStep?.request ?? null,
          startedAt: event.time,
          durationMs: null,
          summary: `approval: ${event.data.toolName}`,
          toolName: event.data.toolName,
          callId: event.data.callId ?? null,
          reason: event.data.reason ?? null,
          outcome: null,
        })
        openApprovals.set(event.data.id, index)
        break
      }

      case 'approval/decided': {
        const index = openApprovals.get(event.data.id)
        if (index === undefined) break
        openApprovals.delete(event.data.id)
        const record = records[index]
        if (record?.kind !== 'approval') break
        record.outcome = event.data.outcome
        record.durationMs = event.time - record.startedAt
        record.summary = `approval: ${record.toolName} → ${event.data.outcome}`
        break
      }

      default:
        break
    }
  }

  const dropped = Math.max(0, records.length - RECORD_WINDOW)
  return {
    sessionId,
    headers,
    records: dropped > 0 ? records.slice(dropped) : records,
    requests,
    turns,
    totals,
    dropped,
    live,
  }
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
