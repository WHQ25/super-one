import type { SessionManager } from '../session/types'
import type { PhoneSessionMethodHost } from './phone-session-methods'

/** Native session actions shared by the desktop window and its paired phone. */
export function createPhoneSessionHost(
  manager: SessionManager,
  openMiniAppForm: PhoneSessionMethodHost['openMiniAppForm'],
): PhoneSessionMethodHost {
  return {
    getSession: id => manager.getSession(id),
    openMiniAppForm,
    suggestedTaskLaunchOptions: async (sessionId, taskId) => {
      const { suggestedTaskLaunchOptions } = await import('../session/suggested-task')
      return suggestedTaskLaunchOptions(manager, sessionId, taskId)
    },
    launchSuggestedTask: async (sessionId, taskId, choice, assertControl) => {
      const parent = manager.getSession(sessionId)
      if (!parent) throw new Error('Session is no longer available')
      parent.lease.assertMutation()
      assertControl()
      const { launchSuggestedTask } = await import('../session/suggested-task')
      return { sessionId: await launchSuggestedTask(manager, sessionId, taskId, choice, assertControl) }
    },
  }
}
