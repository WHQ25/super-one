/**
 * Minimal TypeSafe System One client (POST /v1/systemone).
 *
 * Deliberately not the vendor SDK: the loop needs exactly one call shape, a
 * pinned model, an AbortSignal, and strict answer validation — the SDK adds a
 * dependency for none of those. Thresholds in policy.ts are calibrated against
 * the pinned version; bump `JEV_MODEL` only together with a recalibration.
 */

export const JEV_MODEL = 'jev-1.13.0'
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** Documented context ceiling: 64k total, 32k for state + the longest question. */
export const JEV_TOTAL_TOKEN_BUDGET = 64_000
export const JEV_STATE_TOKEN_BUDGET = 32_000

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }

export interface JevRequest {
  state: unknown
  questions: Record<string, JevQuestion>
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export interface JevNoulAnswer {
  type: 'noul'
  noul: number
}

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer

export interface JevResponse {
  answers: Record<string, JevAnswer>
  model: string
  usage: { input_tokens?: number; output_tokens?: number }
  latencyMs: number
}

export class JevError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'JevError'
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface JevClientOptions {
  apiKey: string
  model?: string
  fetch?: FetchLike
  /** Per-attempt timeout. Jev answers in ~200 ms; anything past this is an outage, not slowness. */
  timeoutMs?: number
}

const RETRY_STATUSES = new Set([429, 503, 529])

/** ~4 chars per token is the vendor's own rule of thumb; used only for the pre-flight budget check. */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

export function assertWithinBudget(request: JevRequest): void {
  const stateTokens = estimateTokens(request.state)
  let longest = 0
  let all = 0
  for (const question of Object.values(request.questions)) {
    const n = estimateTokens(question)
    all += n
    if (n > longest) longest = n
  }
  if (stateTokens + longest > JEV_STATE_TOKEN_BUDGET || stateTokens + all > JEV_TOTAL_TOKEN_BUDGET) {
    throw new JevError(`Jev request over budget: state≈${stateTokens} tokens, questions≈${all}`)
  }
}

function isUnit(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

/**
 * A choice answer is only trusted when it names an offered option, covers every
 * option with a probability, sums to one, and puts the chosen option on top.
 * Anything else is treated as "no answer" rather than acted on.
 */
export function validateChoice(answer: unknown, options: readonly string[]): JevChoiceAnswer | null {
  if (!answer || typeof answer !== 'object') return null
  const a = answer as Partial<JevChoiceAnswer>
  const probabilities = a.probabilities
  if (typeof a.choice !== 'string' || !options.includes(a.choice)) return null
  if (!probabilities || typeof probabilities !== 'object' || !isUnit(a.confidence)) return null
  const keys = Object.keys(probabilities)
  if (keys.length !== options.length || !options.every((o) => isUnit(probabilities[o]))) return null
  const sum = options.reduce((acc, o) => acc + probabilities[o], 0)
  if (Math.abs(sum - 1) > 0.02) return null
  const max = Math.max(...options.map((o) => probabilities[o]))
  if (probabilities[a.choice] < max - 1e-6) return null
  return { type: 'choice', choice: a.choice, probabilities: { ...probabilities }, confidence: a.confidence }
}

export function readNoul(answer: unknown): number | null {
  if (!answer || typeof answer !== 'object') return null
  const n = (answer as Partial<JevNoulAnswer>).noul
  return isUnit(n) ? n : null
}

export function createJevClient(options: JevClientOptions) {
  const model = options.model ?? JEV_MODEL
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 10_000

  async function ask(request: JevRequest, signal?: AbortSignal): Promise<JevResponse> {
    assertWithinBudget(request)
    const body = JSON.stringify({ model, state: request.state, questions: request.questions })
    const started = Date.now()
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      const controller = new AbortController()
      const onAbort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(new JevError('Jev request timed out')), timeoutMs)
      let response: Response
      try {
        response = await doFetch(TYPESAFE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body,
          signal: controller.signal,
        })
      } catch (err) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new JevError('Jev request aborted')
        if (err instanceof JevError) throw err
        throw new JevError(`Jev connection failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      if (RETRY_STATUSES.has(response.status) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        continue
      }
      if (response.status === 401) throw new JevError('Jev rejected the API key (401). Re-enter it in Settings → Browser.', 401)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new JevError(`Jev returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`, response.status)
      }
      const json = await response.json() as { answers?: Record<string, JevAnswer>; model?: string; usage?: JevResponse['usage'] }
      if (!json.answers || typeof json.answers !== 'object') throw new JevError('Jev response had no answers')
      return {
        answers: json.answers,
        model: typeof json.model === 'string' ? json.model : model,
        usage: json.usage ?? {},
        latencyMs: Date.now() - started,
      }
    }
  }

  return { ask, model }
}

export type JevClient = ReturnType<typeof createJevClient>
