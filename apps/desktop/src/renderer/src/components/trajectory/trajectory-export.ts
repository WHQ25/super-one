/**
 * Exporting a loaded window, so a trajectory can leave the panel.
 *
 * Two shapes for two audiences: JSON is the projection verbatim, for a script
 * or a bug report to consume; Markdown is the ledger as a person reads it, for
 * pasting into an issue. Both export exactly what is loaded — an export that
 * silently omitted the unfetched prefix would be a quieter kind of wrong, so
 * the Markdown header states the window it covers.
 */

import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import { formatClock, formatDuration } from './trajectory-format'

/** The projection verbatim. */
export function exportTrajectoryJson(projection: TrajectoryProjection): string {
  return JSON.stringify(projection, null, 2)
}

/**
 * The loaded window as a readable ledger.
 * @param projection - the loaded window.
 * @returns the Markdown document.
 */
export function exportTrajectoryMarkdown(projection: TrajectoryProjection): string {
  const lines: string[] = []
  const { totals } = projection

  lines.push(`# Trajectory ${projection.sessionId}`)
  lines.push('')
  lines.push(`- Records ${projection.firstIndex}–${projection.firstIndex + projection.records.length - 1} of ${projection.total}`)
  lines.push(`- Requests: ${projection.requests.length}`)
  lines.push(`- Tokens: in ${totals.input} · out ${totals.output} · cache read ${totals.cacheRead} · cache write ${totals.cacheWrite} · reasoning ${totals.reasoning}`)
  lines.push('')

  let openTurn: number | null | undefined
  for (const record of projection.records) {
    if (record.turn !== openTurn) {
      openTurn = record.turn
      const turn = projection.turns.findLast((candidate) => candidate.turn === record.turn)
      lines.push('')
      lines.push(record.turn === null
        ? '## Between turns'
        : `## Turn ${record.turn}${turn ? ` — ${turn.steps} steps, ${turn.toolCalls} calls, ${formatDuration(turn.durationMs)}` : ''}`)
      lines.push('')
    }
    const timing = record.durationMs === null ? '' : ` (${formatDuration(record.durationMs)})`
    lines.push(`- \`#${record.index}\` **${record.kind}** ${formatClock(record.startedAt)}${timing} — ${record.summary}`)
  }
  lines.push('')

  return lines.join('\n')
}
