/**
 * The trajectory wire model — SuperOne's own projection of a dsh session log.
 *
 * Nothing here re-exports a `@deepseek-ai/*` type on purpose. The renderer
 * consumes only these shapes, so a dsh version bump can change
 * `SessionEvent` without reaching the panel, and a second producer (a Codex
 * rollout log, a Claude `.jsonl`) can fill the same model later.
 */

/**
 * The record kinds this projection produces. Closed on purpose: a kind with no
 * producer in the mounted plugin tree is dead UI, so `subtool` (code-mode
 * dispatch) and `retry` (`dsh-llm-retry`) are absent until those plugins mount.
 */
export type TrajectoryRecordKind =
  | 'system'
  | 'user'
  | 'context'
  | 'message'
  | 'tool'
  | 'compacted'
  | 'approval'
  | 'preset'

/** Token accounting, with the disjoint cache counts dsh reports separately. */
export interface TrajectoryUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

/**
 * An inspector payload, bounded so one `Read` of a huge file cannot stall the
 * IPC transport. `truncatedChars` is the count dropped from the tail — absent
 * means the text is complete, which is what the inspector claims when it shows
 * "what the model saw".
 */
export interface TrajectoryPayload {
  text: string
  truncatedChars?: number
}

/** A durable image reference, resolved to bytes only when inspected. */
export interface TrajectoryImageRef {
  attachmentId: string
  mediaType: string
  width: number
  height: number
  bytes: number
  name?: string
}

/** One source content block preserved in model order for the inspector. */
export interface TrajectoryBlock {
  type: string
  text: string
  /** `tool-call` / `tool-result` blocks only. */
  callId?: string
  /** `tool-call` blocks only. */
  toolName?: string
  /**
   * `image` blocks only. dsh logs a content-addressed reference rather than
   * bytes, so the inspector fetches the raster on demand instead of the
   * projection carrying every image of a long session across the wire.
   */
  image?: TrajectoryImageRef
}

/** A call configuration, structurally mirroring dsh's `LlmCallConfig`. */
export interface TrajectoryCallConfig {
  provider: string
  model: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

/** A model-visible tool schema, exactly as it was sent. */
export interface TrajectorySchema {
  name: string
  description: string
  parameters: unknown
}

/**
 * One `request/header` snapshot: the complete prompt and tool catalog in force
 * for every request until the next snapshot supersedes it.
 */
export interface TrajectoryHeader {
  /** Ordinal in `TrajectoryProjection.headers`; records reference it by index. */
  index: number
  seq: number
  time: number
  reason: 'initial' | 'resume' | 'change'
  config: TrajectoryCallConfig
  /** Fields the adapter materialized rather than the caller proposing them. */
  adapterDefaults: { reasoningEffort?: true; maxTokens?: true } | null
  system: TrajectoryPayload | null
  tools: TrajectorySchema[]
}

/** One changed call-config field, rendered as a before/after pair. */
export interface TrajectoryFieldChange {
  field: string
  before: string | null
  after: string | null
}

/** One unified-diff hunk over the system prompt. */
export interface TrajectoryDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/**
 * What one header snapshot changed relative to the previous one. The `initial`
 * snapshot has no predecessor and therefore no diff.
 */
export interface TrajectoryHeaderDiff {
  config: TrajectoryFieldChange[]
  systemChanged: boolean
  /** Empty when the system prompt is unchanged; context-collapsed otherwise. */
  systemHunks: TrajectoryDiffHunk[]
  toolsAdded: string[]
  toolsRemoved: string[]
  /** Same name, different description or parameters. */
  toolsChanged: string[]
}

/** Fields every ledger record carries, whatever its kind. */
interface TrajectoryRecordBase {
  /** Stable across re-projection: the owning event seq or tool call id. */
  id: string
  /** 1-based position in the projected window. */
  index: number
  seq: number
  /** Owning turn, or `null` for a record between turns (standalone compaction). */
  turn: number | null
  step: number | null
  /** 1-based ordinal of the owning request, or `null` outside one. */
  request: number | null
  /** Unix epoch ms when this record's operation started. */
  startedAt: number
  /**
   * Own duration in ms. `null` means unknown — a still-running operation or a
   * record that is an instant, never a fabricated zero.
   */
  durationMs: number | null
  /** Single-line ledger summary, already flattened out of markdown. */
  summary: string
}

/**
 * One ledger record. The kind tag narrows the whole record, so a consumer
 * switching on `record.kind` gets its detail fields without a second lookup.
 */
export type TrajectoryRecord = TrajectoryRecordBase & (
  | {
    kind: 'system'
    /** Index into `TrajectoryProjection.headers`. */
    header: number
    change: TrajectoryHeaderDiff | null
  }
  | { kind: 'user'; content: TrajectoryPayload; blocks: TrajectoryBlock[] }
  | {
    kind: 'context'
    content: TrajectoryPayload
    blocks: TrajectoryBlock[]
    /** The plugin that injected this context. */
    producer: string
    /** dsh's `ContextForm`, when the producer declared one. */
    form: string | null
    /** A `notice` form's one-line account. */
    notice: string | null
    /** A `snapshot` form's named contributions, in assembly order. */
    sections: { name: string; text: string }[] | null
  }
  | {
    kind: 'message'
    text: TrajectoryPayload
    thinking: TrajectoryPayload | null
    blocks: TrajectoryBlock[]
    provider: string
    model: string
    usage: TrajectoryUsage | null
    /** Time to first token, from step start to the first non-empty delta. */
    ttftMs: number | null
  }
  | {
    kind: 'tool'
    name: string
    callId: string
    /** Raw arguments JSON exactly as the model produced it. */
    args: TrajectoryPayload
    /** `null` while the call is still running. */
    result: TrajectoryPayload | null
    /** The schema this tool was advertised with at call time. */
    schema: TrajectorySchema | null
    isError: boolean
    error: { name: string; code: string } | null
  }
  | {
    kind: 'compacted'
    trigger: 'manual' | 'auto'
    preTokens: number | null
    postTokens: number | null
    /** The compaction's replacement summary text. */
    compactionSummary: TrajectoryPayload | null
  }
  | {
    kind: 'preset'
    /** The preset this session was re-composed onto. */
    preset: string
  }
  | {
    kind: 'approval'
    toolName: string
    callId: string | null
    reason: string | null
    /** `null` while the ask is still open. */
    outcome: string | null
  }
)

/** One model call (or compaction call), numbered across both purposes. */
export interface TrajectoryRequest {
  /** 1-based, chronological, shared by ordinary and compaction requests. */
  ordinal: number
  seq: number
  purpose: 'generation' | 'compaction'
  turn: number | null
  step: number | null
  startedAt: number
  durationMs: number | null
  ttftMs: number | null
  usage: TrajectoryUsage | null
  route: { provider: string; model: string; contextWindow: number | null } | null
  /** Index into `TrajectoryProjection.headers`, or `null` before the first. */
  header: number | null
}

/** One turn boundary, for the ledger's rule and its folded-row label. */
export interface TrajectoryTurn {
  turn: number
  startedAt: number
  durationMs: number | null
  /** dsh's `TurnEndReason.kind`; `null` while the turn is still open. */
  outcome: string | null
  steps: number
  toolCalls: number
}

/** The complete projection of one session log window. */
export interface TrajectoryProjection {
  sessionId: string
  headers: TrajectoryHeader[]
  records: TrajectoryRecord[]
  requests: TrajectoryRequest[]
  turns: TrajectoryTurn[]
  /** Cumulative usage over the whole fold, not just the loaded window. */
  totals: TrajectoryUsage
  /**
   * The `index` of `records[0]`, so a loaded window states where it sits in the
   * fold. `1` means the window reaches the start of the session; anything
   * higher means an earlier page can still be requested.
   */
  firstIndex: number
  /** How many records the fold holds, loaded window included. */
  total: number
  /** How many source events the fold has consumed — the delta cursor. */
  cursor: number
  /** Whether the source session is still live. */
  live: boolean
}

/**
 * What changed in the fold since a caller's cursor.
 *
 * A trajectory grows by appending records, but it also *revises* them: a
 * `tool/result` completes a call opened thousands of events earlier, an
 * approval decision lands after the user answers. So a delta carries both, and
 * every entry is a whole record addressed by its stable `index` — the consumer
 * merges by position and never has to replay a patch.
 */
export interface TrajectoryDelta {
  /** The cursor to send on the next poll. */
  cursor: number
  /**
   * Records created or revised since the cursor, in ledger order. Whole
   * records, so a consumer merges by `index` without replaying a patch, and a
   * record revised twice between polls arrives once, in its final state.
   */
  records: TrajectoryRecord[]
  /** Header snapshots created since the cursor, in `index` order. */
  headers: TrajectoryHeader[]
  /** Requests created or revised since the cursor, addressed by `ordinal`. */
  requests: TrajectoryRequest[]
  /** Turns created or revised since the cursor, addressed by `turn`. */
  turns: TrajectoryTurn[]
  totals: TrajectoryUsage
  total: number
  live: boolean
}

/** One page of records older than the caller's loaded window. */
export interface TrajectoryPage {
  records: TrajectoryRecord[]
  /** The `index` of `records[0]`, or the caller's own first index when empty. */
  firstIndex: number
}

/**
 * What the inspector asks for when a bounded payload is not enough.
 *
 * Text refs name a record field rather than carrying an offset: the fold owns
 * the untruncated text, and a field name survives a re-fold while a byte range
 * would not.
 */
export type TrajectoryPayloadRef =
  | { kind: 'text'; recordId: string; field: string }
  /** The whole reference: dsh verifies stored bytes against it on read. */
  | { kind: 'image'; image: TrajectoryImageRef }

/**
 * What the trajectory IPC answers with.
 *
 * `absent` is a first-class answer, not a failure. A SuperOne session exists
 * from the moment the user opens it, while its dsh session only exists once a
 * turn has run — reporting that as an error would tell every user opening a
 * fresh session that something broke.
 *
 * A genuine failure is reported rather than thrown across the boundary: the
 * panel is a diagnostic surface, and "the log is there and unreadable, here is
 * why" is more useful than an empty ledger.
 *
 * A caller that sends no cursor gets a `full` window; one that sends the cursor
 * it last received gets a `delta`, unless the fold was rebuilt underneath it
 * (a live session reopened, a re-fold after restart), which answers `full`
 * again so the consumer never merges onto a foreign fold.
 */
export type TrajectoryResult =
  | { ok: true; kind: 'full'; trajectory: TrajectoryProjection }
  | { ok: true; kind: 'delta'; delta: TrajectoryDelta }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'error'; error: string }

/** What the backward-paging IPC answers with. */
export type TrajectoryPageResult =
  | { ok: true; page: TrajectoryPage }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'error'; error: string }

/** What the on-demand payload IPC answers with. */
export type TrajectoryPayloadResult =
  | { ok: true; kind: 'text'; text: string }
  /** A `data:` URL, so the inspector renders the raster without a file route. */
  | { ok: true; kind: 'image'; dataUrl: string }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'error'; error: string }
