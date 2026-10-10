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
    onNotification: notification => prediction.observe(notification),
    onSkillsChanged: () => notifyCodexSkillsChanged(session.projectPath),
    onQueueChanged: threadId => session.queueChangedFn?.(threadId),
    isMainTurnActive: () => Boolean(session.runningController),
  })
}
