/**
 * The one-shot projection: fold a complete dsh session log and take its window.
 *
 * This is the closed-session path and the shape tests read. A live session
 * instead keeps a {@link TrajectoryFold} open across polls, so its streaming
 * turn is folded event by event rather than from the log's start.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import { TrajectoryFold, RECORD_WINDOW } from './fold'

export { RECORD_WINDOW }

/**
 * Fold a dsh session log into the trajectory wire model.
 * @param sessionId - the session the log belongs to.
 * @param events - the log in seq order.
 * @param live - whether the source session is still running.
 * @returns the projection, with its window bounded to {@link RECORD_WINDOW}.
 */
export function projectTrajectory(
  sessionId: string,
  events: readonly SessionEvent[],
  live: boolean,
): TrajectoryProjection {
  const fold = new TrajectoryFold(sessionId)
  fold.consume(events)
  return fold.snapshot(live)
}
