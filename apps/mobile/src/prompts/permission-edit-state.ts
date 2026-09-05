import { CONFIG_APPLY_FIELD, VIDEO_GEN_PARAMS_FIELD, SESSION_AGENT_LAUNCHES_FIELD, type PermissionRequest, type SessionAgentLaunchProposal } from '@superone/shared/agent-types'
import { resolveCollaborationLaunches } from '../collaboration-state'

export function editablePermission(request: PermissionRequest): PermissionRequest {
  return { ...request, sessionAgentsConfirm: request.sessionAgentsConfirm ? { ...request.sessionAgentsConfirm, launches: resolveCollaborationLaunches(request.sessionAgentsConfirm) } : undefined }
}

export function editedPermissionAnswers(request: PermissionRequest): Record<string, unknown> | undefined {
  if (request.videoGenConfirm) return { [VIDEO_GEN_PARAMS_FIELD]: JSON.stringify(request.videoGenConfirm.params) }
  if (request.configConfirm) return { [CONFIG_APPLY_FIELD]: JSON.stringify(Object.fromEntries([...(request.configConfirm.fields ?? []), ...(request.configConfirm.resource?.fields ?? [])].map((field) => [field.key, field.proposedValue]))) }
  if (request.sessionAgentsConfirm) return { [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(request.sessionAgentsConfirm.launches) }
  const payload = request.automationConfirm
  if (!payload || payload.operation === 'delete') return undefined
  const agent = payload.changes?.find((change) => change.field === 'agent')?.agentTo ?? payload.items[0]?.agent
  const enabled = payload.items[0]?.enabled
  // The host expects AgentRunConfig, including Codex's persisted aliases.
  const agentConfig = agent ? { ...agent, ...(agent.type === 'codex' ? {
    permissionPreset: agent.permissionMode ? agent.permissionMode === 'auto' ? 'auto-review' : ['bypassPermissions', 'acceptEdits'].includes(agent.permissionMode) ? 'full-access' : 'default' : agent.permissionPreset ?? 'default',
    ...(agent.effort ? { reasoningEffort: agent.effort } : {}),
  } : {}) } : undefined
  return { ...(agentConfig ? { agentConfig } : {}), ...(enabled !== undefined ? { enabled } : {}) }
}

export function permissionEditsValid(request: PermissionRequest): boolean {
  const params = request.videoGenConfirm?.params
  if (params && (!params.prompt.trim() || !params.provider || !params.model || !Number.isFinite(params.duration) || params.duration <= 0 || [params.fps, params.seed].some((value) => value !== undefined && !Number.isFinite(value)))) return false
  return [...(request.configConfirm?.fields ?? []), ...(request.configConfirm?.resource?.fields ?? [])].every((field) => {
    const value = field.proposedValue
    if (value === null) return Boolean(field.clearable)
    if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)
    if (field.type === 'enum' && field.enumValues?.length) return field.enumValues.includes(String(value))
    return true
  })
}

/** Only run tuning is editable: preserve host-owned identity, mode, task and workspace. */
export function patchLaunch(launch: SessionAgentLaunchProposal, patch: Partial<Pick<SessionAgentLaunchProposal['config'], 'model' | 'effort' | 'apiProviderId' | 'fastMode' | 'permissionMode' | 'sandboxMode'>>) {
  return { ...launch, config: { ...launch.config, ...patch } }
}
