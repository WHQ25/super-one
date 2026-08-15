/**
 * Outcome line for a background-task wake. The status label already names
 * completed/failed/stopped; harnesses often echo the task title as `summary`.
 */
const TAUTOLOGICAL_SUMMARIES = new Set([
  'completed',
  'complete',
  'finished',
  'failed',
  'stopped',
  'killed',
  'cancelled',
  'canceled',
])

/** Keep `summary` only when it adds something the title / status do not. */
export function usefulTaskNotificationSummary(
  summary: string | undefined,
  description: string | undefined,
): string | undefined {
  const text = summary?.trim()
  if (!text) return undefined
  const title = description?.trim()
  if (title && text.toLowerCase() === title.toLowerCase()) return undefined
  if (TAUTOLOGICAL_SUMMARIES.has(text.toLowerCase())) return undefined
  return text
}
