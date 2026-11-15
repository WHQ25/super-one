/** One-shot next-message sample. The server captures text before tools run. */
export const CODEX_PROMPT_SAMPLE_TIMEOUT_MS = 30_000

/**
 * Parent turns often run at max. A suggestion is one short message, so the
 * sample asks for the lowest catalog effort. The server keeps the parent
 * effort when that model cannot change it without dropping the prompt cache.
 */
export const CODEX_PROMPT_SAMPLE_EFFORT = 'low'

/**
 * SuperOne-owned prompt. The official app loads its wording from a private
 * config service and only appends the JSON schema locally.
 */
export const CODEX_PROMPT_SUGGESTION_PROMPT = [
  'Predict the next message the user will send in this coding session.',
  'Match the language the user has been writing in.',
  'The suggestion is one short message they can send as-is.',
  'Use null when the work looks finished or the next step is not obvious.',
  'Do not call tools.',
  'Return only JSON matching this schema: {"suggestion":string|null}.',
].join('\n')

export interface CodexPromptSampleClient {
  request(
    method: string,
    params?: Record<string, unknown>,
    options?: { signal?: AbortSignal, timeoutMs?: number },
  ): Promise<Record<string, unknown>>
}

export function readCodexCollaborationModeName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const record = asRecord(value)
  const mode = record?.mode
  return typeof mode === 'string' && mode.trim() ? mode.trim() : null
}

/** `turn_completed` watched the turn end. `catch_up` found it already finished. */
export type CodexPromptSampleTrigger = 'turn_completed' | 'catch_up'

export function codexPromptSampleParams(
  threadId: string,
  expectedTurnId: string,
  trigger: CodexPromptSampleTrigger = 'turn_completed',
): Record<string, unknown> {
  return {
    threadId,
    expectedTurnId,
    prompt: CODEX_PROMPT_SUGGESTION_PROMPT,
    effort: CODEX_PROMPT_SAMPLE_EFFORT,
    threadSource: 'composer_predictions',
    turnTrigger: 'composer_predictions',
    disableMcp: true,
    responsesapiClientMetadata: {
      prediction_source_thread_id: threadId,
      prediction_source_turn_id: expectedTurnId,
      prediction_trigger: trigger,
    },
  }
}

/** Newest turn on a descending `thread/turns/list` page, when that turn finished cleanly. */
export function readLatestCompletedCodexTurnId(page: unknown): string | null {
  const record = asRecord(page)
  const turns = Array.isArray(record?.data) ? record.data : []
  const turn = asRecord(turns[0])
  const id = typeof turn?.id === 'string' ? turn.id.trim() : ''
  if (!id || turn?.status !== 'completed') return null
  return id
}

/** `undefined` means the response was unreadable and the composer should stay as it is. */
export function readCodexPromptSampleSuggestion(result: unknown): string | null | undefined {
  const record = asRecord(result)
  if (!record || !('text' in record)) return undefined
  const text = record.text
  if (text === null) return null
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    const body = asRecord(JSON.parse(text))
    if (!body || !('suggestion' in body)) return undefined
    if (body.suggestion === null) return null
    if (typeof body.suggestion !== 'string') return undefined
    const suggestion = body.suggestion.trim()
    return suggestion.length > 0 ? suggestion : null
  } catch {
    return undefined
  }
}

export async function sampleCodexPromptSuggestion(
  client: CodexPromptSampleClient,
  threadId: string,
  expectedTurnId: string,
  signal: AbortSignal,
  trigger: CodexPromptSampleTrigger = 'turn_completed',
): Promise<string | null | undefined> {
  if (signal.aborted) return undefined
  const timeout = AbortSignal.timeout(CODEX_PROMPT_SAMPLE_TIMEOUT_MS)
  const combined = AbortSignal.any([signal, timeout])
  try {
    const result = await client.request('thread/sample', codexPromptSampleParams(threadId, expectedTurnId, trigger), {
      signal: combined,
      timeoutMs: CODEX_PROMPT_SAMPLE_TIMEOUT_MS,
    })
    if (signal.aborted) return undefined
    return readCodexPromptSampleSuggestion(result)
  } catch {
    return undefined
  }
}

/**
 * Look up the newest finished turn and ask the predictor to sample it.
 * The predictor ignores a turn it is already sampling or has already sampled.
 */
export async function catchUpCodexPromptSuggestion(
  client: CodexPromptSampleClient,
  prediction: { catchUp(threadId: string, turnId: string): void },
  threadId: string,
): Promise<void> {
  const page = await client.request('thread/turns/list', {
    threadId,
    sortDirection: 'desc',
    itemsView: 'notLoaded',
    limit: 1,
  })
  const turnId = readLatestCompletedCodexTurnId(page)
  if (turnId) prediction.catchUp(threadId, turnId)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
