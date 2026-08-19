import type { EffortLevel } from '@superone/shared/agent-types'

/**
 * dsh reasoning-effort ids are adapter-owned and deliberately opaque
 * (`ReasoningEffortId`); the official DeepSeek adapter ships
 * `off | low | high | max`. SuperOne's `EffortLevel` is one fixed five-step
 * vocabulary shared by every harness, so the two overlap on three values and
 * neither contains the other.
 *
 * Both directions live here because the mismatch bites twice. A level the
 * picker cannot express must not reach the UI, and a level the adapter does not
 * accept must not reach `setRoute` — `dsh-llm-deepseek` rejects an unsupported
 * effort with `UNSUPPORTED_REASONING_EFFORT` before any provider I/O, and the
 * llm service performs no clamping or aliasing on the caller's behalf.
 *
 * Unknown ids drop out rather than throwing: catalog membership is advisory in
 * dsh, and a third-party adapter registered into the tree may advertise efforts
 * this vocabulary has never heard of.
 */
const DSH_TO_SUPERONE: Readonly<Record<string, EffortLevel>> = {
  low: 'low',
  high: 'high',
  max: 'max',
  // `off` (thinking disabled) has no SuperOne counterpart — the shared
  // vocabulary has no "no reasoning" step. Dropping it means a deployment
  // configured `thinking: 'disabled'` advertises no usable effort at all and
  // the picker correctly collapses to a model-only list.
}

const SUPERONE_TO_DSH: Readonly<Partial<Record<EffortLevel, string>>> = {
  low: 'low',
  high: 'high',
  max: 'max',
  // `medium` / `xhigh` have no DeepSeek counterpart. They can only arrive from
  // a session pref persisted under another harness, and mapping them to a
  // neighbouring step would silently run a turn at an effort nobody chose.
}

/**
 * Project one model's adapter-advertised efforts onto the levels the picker can
 * show, preserving the adapter's display order and dropping duplicates.
 */
export function superoneEffortsFromDsh(ids: readonly string[]): EffortLevel[] {
  const levels: EffortLevel[] = []
  for (const id of ids) {
    const level = DSH_TO_SUPERONE[id]
    if (level !== undefined && !levels.includes(level)) levels.push(level)
  }
  return levels
}

/**
 * Translate a SuperOne effort back to the id the adapter accepts. `undefined`
 * means "do not set one", which leaves the adapter's own default in force —
 * the correct outcome for a level DeepSeek does not implement.
 */
export function dshEffortFromSuperone(effort: string | null | undefined): string | undefined {
  if (effort === null || effort === undefined) return undefined
  return SUPERONE_TO_DSH[effort as EffortLevel]
}
