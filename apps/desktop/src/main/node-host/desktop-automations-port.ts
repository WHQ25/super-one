import type { Automation } from '@superone/shared/agent-types'
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationsForProject,
  updateAutomation,
} from '../db-automations'
import { notifyAutomationsListChanged, runAutomationNow } from '../automation-service'
import type { DesktopConfig } from './desktop-config-methods'

/**
 * `automation.*` over this desktop's automations table and scheduler. A
 * client's change re-lists the window's sidebar the way its own edits do.
 */
export function createDesktopAutomationsPort(): DesktopConfig['automations'] {
  const withProject = (automation: Automation, projectId: string) => ({ ...automation, projectId })
  return {
    automations: {
      listForProject: (projectId, projectPath) =>
        listAutomationsForProject(projectPath).map((automation) => withProject(automation, projectId)),
      get: getAutomation,
      create(projectId, projectPath, data) {
        const created = createAutomation(projectPath, data)
        notifyAutomationsListChanged(projectPath)
        return withProject(created, projectId)
      },
      update(id, data) {
        if (!updateAutomation(id, data)) return undefined
        const updated = getAutomation(id)
        notifyAutomationsListChanged(updated?.projectPath)
        return updated
      },
      delete(id) {
        const existing = getAutomation(id)
        const ok = deleteAutomation(id)
        if (ok) notifyAutomationsListChanged(existing?.projectPath)
        return ok
      },
    },
    automationService: { runNow: runAutomationNow },
  }
}
