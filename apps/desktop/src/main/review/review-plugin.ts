import { createServiceToken } from '@superone/runtime/plugin-kernel'
import type { MainPluginDefinition } from '../kernel/main-plugin-host'
import type { SessionManagerImpl } from '../session/session-manager'
import { createReviewIpcHandlers } from './review-ipc'
import { TurnDiffTracker } from './turn-diff-tracker'

export interface ReviewMainService {
  readonly tracker: TurnDiffTracker
  cleanupSession(sessionId: string): void
}

export const ReviewServiceToken = createServiceToken<ReviewMainService>('builtin.review')

export function createReviewMainPlugin(deps: { sessionManager: SessionManagerImpl }): MainPluginDefinition {
  return {
    id: 'builtin.review',
    setup(scope) {
      const tracker = new TurnDiffTracker(deps.sessionManager)
      tracker.attach()
      scope.onDispose(() => {
        tracker.dispose()
      })
      scope.provideService(ReviewServiceToken, {
        tracker,
        cleanupSession(sessionId: string) {
          tracker.cleanupSession(sessionId)
        },
      })
      for (const [channel, handler] of createReviewIpcHandlers(tracker)) {
        scope.registerIpc(channel, handler)
      }
    },
  }
}
