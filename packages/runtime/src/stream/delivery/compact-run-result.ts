/** Keep the run card's bounded presentation data, without its large page snapshot. */
export function compactRunResult(summary: string): string | null {
  let value: unknown
  try { value = JSON.parse(summary) } catch { return null }
  const obj = record(value)
  if (!obj || typeof obj.runId !== 'string') return null
  if (obj.status !== 'paused' && obj.status !== 'done' && obj.status !== 'aborted') return null
  const progress = record(obj.progress)
  const question = record(obj.question)
  const context = record(question?.context)
  return JSON.stringify({
    status: obj.status,
    runId: obj.runId,
    ...numbers(obj, ['steps', 'elapsed_ms']),
    ...strings(obj, ['why']),
    ...(progress ? { progress: {
      ...numbers(progress, ['goal_satisfied', 'still_loading']),
      ...strings(progress, ['note']),
      completed: records(progress.completed, 200).map((step) => strings(step, ['label', 'op', 'target', 'outcome'])),
    } } : {}),
    ...(question ? { question: {
      ...strings(question, ['id', 'reason', 'type']),
      context: context ? strings(context, ['why']) : {},
      options: records(question.options, 100).map((option) => strings(option, ['key', 'label'])),
    } } : {}),
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function records(value: unknown, limit: number): Record<string, unknown>[] {
  return Array.isArray(value) ? value.slice(0, limit).flatMap((item) => {
    const obj = record(item)
    return obj ? [obj] : []
  }) : []
}

function strings(obj: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => typeof obj[key] === 'string' ? [[key, obj[key].slice(0, 500)]] : []))
}

function numbers(obj: Record<string, unknown>, keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.flatMap((key) => typeof obj[key] === 'number' && Number.isFinite(obj[key]) ? [[key, obj[key]]] : []))
}
