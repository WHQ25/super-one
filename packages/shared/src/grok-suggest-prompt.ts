/**
 * Grok `x.ai/suggestPrompt`: client-pull after a successful idle turn.
 *
 * The pager sends camelCase `{ generation, sessionId, model? }` and unwraps
 * `result.suggestion`. SuperOne must call the `_x.ai/suggestPrompt` wire name;
 * Grok registers the bare method behind that ACP prefix.
 */

export const XAI_SUGGEST_PROMPT = 'x.ai/suggestPrompt'
export const XAI_SUGGEST_PROMPT_WIRE = `_${XAI_SUGGEST_PROMPT}`
/** Matches grok-build's shell-side round-trip bound. */
export const SUGGEST_PROMPT_TIMEOUT_MS = 45_000

const SILENCE = ['none', 'n/a', 'no suggestion', 'nothing', '(silence)', 'silence', 'null']

export function buildGrokSuggestPromptParams(
  generation: number,
  sessionId: string,
  model?: string,
): { generation: number; sessionId: string; model?: string } {
  return {
    generation,
    sessionId,
    ...(model ? { model } : {}),
  }
}

export function shouldFetchGrokSuggestPrompt(opts: {
  grok: boolean
  complete: boolean
  interrupted: boolean
  text: string
}): boolean {
  return (
    opts.grok
    && opts.complete
    && !opts.interrupted
    && !opts.text.trimStart().startsWith('/')
  )
}

/** First-line sanitize matching grok-build `sanitize_suggestion`. */
export function sanitizeGrokPromptSuggestion(raw: string): string | null {
  const line = raw.trim().split('\n', 1)[0]?.trim().replace('<|eos|>', '') ?? ''
  const cleaned = line
    .replace(/^["'`“‘]+/, '')
    .replace(/["'`”’]+$/, '')
    .trim()
  if (!cleaned) return null
  const lowered = cleaned.toLowerCase()
  if (SILENCE.some((token) => lowered === token || lowered.startsWith(`${token}.`))) {
    return null
  }
  return cleaned
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Accepts the SDK result object or a JSON-RPC envelope with `result`.
 * A generation mismatch, null suggestion, or silence token is no suggestion.
 */
export function parseGrokSuggestPromptResult(raw: unknown, generation: number): string | null {
  const root = asRecord(raw)
  if (!root) return null
  const payload = asRecord(root.result) ?? root
  const echoed = payload.generation
  if (typeof echoed === 'number' && Number.isFinite(echoed) && echoed !== generation) {
    return null
  }
  if (typeof payload.suggestion !== 'string') return null
  return sanitizeGrokPromptSuggestion(payload.suggestion)
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('suggestPrompt timed out')), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Request a next-prompt suggestion. Method-not-found, timeout, and parse
 * failures return null so a missing generator never blocks turn teardown.
 */
export async function fetchGrokSuggestPrompt(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  args: {
    generation: number
    sessionId: string
    model?: string
    method?: string
    timeoutMs?: number
  },
): Promise<string | null> {
  const method = args.method ?? XAI_SUGGEST_PROMPT_WIRE
  const timeoutMs = args.timeoutMs ?? SUGGEST_PROMPT_TIMEOUT_MS
  const params = buildGrokSuggestPromptParams(args.generation, args.sessionId, args.model)
  try {
    const raw = await withTimeout(request(method, params), timeoutMs)
    return parseGrokSuggestPromptResult(raw, args.generation)
  } catch {
    return null
  }
}
