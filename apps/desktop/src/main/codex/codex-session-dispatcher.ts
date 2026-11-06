import { processServerRequest } from './codex-turn'
import log from '../logger'
import { createCodexPromptPrediction } from '@superone/codex/prompt-prediction'
import type { AppServerConnection } from './app-server-connection'
import { createNotificationDispatcher, type NotificationDispatcher } from './codex-notification-dispatcher'
import type { CodexSession } from './codex-session'
import { notifyCodexSkillsChanged } from './codex-skills-watcher'

/** Keep ambient session notifications alive independently of the turn inbox. */
export function createCodexSessionDispatcher(session: CodexSession, connection: AppServerConnection): NotificationDispatcher {
  const prediction = createCodexPromptPrediction({
    getThreadId: () => session.threadId,
    onSuggestion: suggestion => {
      if (session.promptPrediction === prediction) session.forkCallbacks?.onPromptSuggestion?.(suggestion)
    },
  })
  session.promptPrediction = prediction
  return createNotificationDispatcher(connection, {
    onNotification: notification => {
      // Checkpoints can be replayed during resume, before a turn inbox has a reader.
      if (notification.requestIdRaw !== undefined
        && notification.method === 'item/commandExecution/requestApproval'
        && notification.params.kind === 'humanCommand' && session.forkCallbacks) {
        void processServerRequest(notification, connection, session, session.forkCallbacks, notification.params.threadId === session.threadId ? session.runningController?.signal : undefined)
          .catch(error => log.warn('[codex] human checkpoint failed:', error))
        return true
      }
      return prediction.observe(notification)
    },
    onSkillsChanged: () => notifyCodexSkillsChanged(session.projectPath),
    onQueueChanged: threadId => session.queueChangedFn?.(threadId),
    isMainTurnActive: () => Boolean(session.runningController),
  })
}
