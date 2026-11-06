import type { Automation, CreateAutomationRequest, UpdateAutomationRequest } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from './remote-project-key'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'

const changedEvent = 'superone:project-automations-changed'
export function onProjectAutomationsChanged(listener: (projectPath: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail)
  window.addEventListener(changedEvent, handler)
  return () => window.removeEventListener(changedEvent, handler)
}

async function targetFor(projectPath: string) {
  const remote = parseRemoteProjectKey(projectPath)
  const listed = useMultiHostSidebarStore.getState().environments.flatMap((bucket) => bucket.checkouts)
    .find((checkout) => checkout.pathKey === projectPath)
  if (listed) return { connectionId: remote?.connectionId ?? 'local', projectId: listed.projectId }
  if (!remote) return { connectionId: 'local', projectId: projectPath }
  const project = (await window.environment.listProjects(remote.connectionId)).find((entry) => entry.path === remote.path)
  if (!project) throw new Error('Project not found')
  return { connectionId: remote.connectionId, projectId: project.projectId }
}

function changed(projectPath: string) { window.dispatchEvent(new CustomEvent(changedEvent, { detail: projectPath })) }

export async function listProjectAutomations(projectPath: string): Promise<Automation[]> {
  const { connectionId, projectId } = await targetFor(projectPath)
  const result = await window.environment.callAutomation(connectionId, 'automation.list', { projectId })
  return result.automations.map((automation) => ({ ...automation, projectPath }))
}

export async function createProjectAutomation(projectPath: string, data: CreateAutomationRequest): Promise<Automation> {
  const { connectionId, projectId } = await targetFor(projectPath)
  const { automation } = await window.environment.callAutomation(connectionId, 'automation.create', { projectId, ...data })
  changed(projectPath)
  return { ...automation, projectPath }
}

export async function updateProjectAutomation(projectPath: string, automationId: string, data: UpdateAutomationRequest): Promise<void> {
  const { connectionId, projectId } = await targetFor(projectPath)
  await window.environment.callAutomation(connectionId, 'automation.update', { projectId, automationId, ...data })
  changed(projectPath)
}

export async function deleteProjectAutomation(projectPath: string, automationId: string): Promise<void> {
  const { connectionId, projectId } = await targetFor(projectPath)
  await window.environment.callAutomation(connectionId, 'automation.delete', { projectId, automationId })
  changed(projectPath)
}

export async function runProjectAutomation(projectPath: string, automationId: string): Promise<void> {
  const { connectionId, projectId } = await targetFor(projectPath)
  await window.environment.callAutomation(connectionId, 'automation.runNow', { projectId, automationId })
  changed(projectPath)
}
