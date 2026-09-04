import {
  CONFIG_APPLY_FIELD,
  VIDEO_GEN_PARAMS_FIELD,
  type ElicitationFormField,
  type PermissionRequest,
} from '@superone/shared/agent-types'
import { buildCollaborationFormAnswers } from './collaboration-state'

export type PermissionSheetItem = {
  title: string
  subtitle?: string
  warning?: boolean
}

export type PermissionSheetPresentation = {
  title: string
  description?: string
  approveLabel: string
  denyLabel: string
  alwaysLabel?: string
  items: PermissionSheetItem[]
  destructive?: boolean
}

function valueLabel(value: unknown, secret = false): string {
  if (secret && value) return '••••••••'
  if (value === undefined) return 'Default'
  if (value === null) return 'None'
  if (typeof value === 'string') return value || 'Empty'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function genericToolName(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, '').replace(/[_-]+/g, ' ').trim() || 'tool'
}

export function permissionSheetPresentation(request: PermissionRequest): PermissionSheetPresentation {
  switch (request.requestKind) {
    case 'mcp_elicitation':
      return {
        title: request.message || `Allow ${request.serverName || genericToolName(request.toolName)}?`,
        description: request.subtitle || 'The connected tool needs more information before it can continue.',
        approveLabel: 'Continue',
        denyLabel: 'Decline',
        alwaysLabel: request.supportsAlwaysPersist ? 'Continue & remember' : undefined,
        items: [],
      }
    case 'video_gen_confirm': {
      const payload = request.videoGenConfirm
      return {
        title: 'Create this video?',
        description: payload?.params.prompt || 'Review the generation settings before starting.',
        approveLabel: 'Generate video',
        denyLabel: 'Cancel',
        items: payload ? [
          { title: `${payload.params.provider} · ${payload.params.model}`, subtitle: 'Provider and model' },
          { title: `${payload.params.aspectRatio} · ${payload.params.resolution}`, subtitle: 'Frame' },
          { title: `${payload.params.duration}s${payload.params.fps ? ` · ${payload.params.fps} fps` : ''}`, subtitle: 'Duration' },
        ] : [],
      }
    }
    case 'config_confirm': {
      const payload = request.configConfirm
      const resource = payload?.resource
      const fields = [...(payload?.fields ?? []), ...(resource?.fields ?? [])]
      const operation = resource?.operation
      return {
        title: resource
          ? `${operation === 'delete' ? 'Delete' : operation === 'create' ? 'Create' : 'Update'} ${resource.title}?`
          : 'Apply these settings?',
        description: resource?.subtitle || 'Review the proposed configuration before applying it.',
        approveLabel: operation === 'delete' ? 'Delete' : 'Apply',
        denyLabel: 'Cancel',
        destructive: operation === 'delete',
        items: fields.map((field) => ({
          title: field.label,
          subtitle: `${valueLabel(field.currentValue, field.secret)} → ${valueLabel(field.proposedValue, field.secret)}`,
        })),
      }
    }
    case 'session_agents_confirm': {
      const payload = request.sessionAgentsConfirm
      return {
        title: 'Approve collaboration?',
        description: 'These agents or linked sessions will join the current task.',
        approveLabel: `Approve ${payload?.launches.length ?? 0} launch${payload?.launches.length === 1 ? '' : 'es'}`,
        denyLabel: 'Deny',
        items: [],
      }
    }
    case 'computer_use_grant': {
      const grant = request.computerUseGrant
      const app = grant?.app || String(request.input.app || 'this app')
      return {
        title: `Allow control of ${app}?`,
        description: 'Computer Use can observe and interact with this desktop app for the current session.',
        approveLabel: 'Allow this session',
        denyLabel: 'Deny',
        alwaysLabel: request.allowAlwaysAllow ? 'Always allow this app' : undefined,
        items: [
          ...(grant?.bundleId ? [{ title: grant.bundleId, subtitle: 'Application' }] : []),
          { title: grant?.toolName || request.toolName, subtitle: 'Requested by' },
        ],
      }
    }
    case 'session_cleanup_confirm': {
      const sessions = request.sessionCleanupConfirm?.sessions ?? []
      return {
        title: `Permanently delete ${sessions.length} session${sessions.length === 1 ? '' : 's'}?`,
        description: 'Deleted sessions and their stored transcripts cannot be recovered.',
        approveLabel: 'Delete permanently',
        denyLabel: 'Keep sessions',
        destructive: true,
        items: sessions.map((session) => ({
          title: session.title || 'Untitled',
          subtitle: [session.harness, session.messageCount === undefined ? undefined : `${session.messageCount} messages`]
            .filter(Boolean)
            .join(' · '),
          warning: true,
        })),
      }
    }
    case 'automation_confirm': {
      const payload = request.automationConfirm
      const operation = payload?.operation ?? 'update'
      const count = payload?.items.length ?? 0
      return {
        title: `${operation === 'delete' ? 'Delete' : operation === 'create' ? 'Create' : 'Update'} ${count} automation${count === 1 ? '' : 's'}?`,
        description: operation === 'delete'
          ? 'The selected schedules will stop running.'
          : 'Review the schedule and agent configuration before saving.',
        approveLabel: operation === 'delete' ? 'Delete' : 'Save automation',
        denyLabel: 'Cancel',
        destructive: operation === 'delete',
        items: (payload?.items ?? []).map((item) => ({
          title: item.name,
          subtitle: [item.scheduleSummary, item.agent?.type || item.agentType, item.promptPreview]
            .filter(Boolean)
            .join(' · '),
        })),
      }
    }
    case 'webmcp_trust_confirm': {
      const payload = request.webmcpTrustConfirm
      const origin = payload?.origin || String(request.input.origin || 'this site')
      return {
        title: payload?.reason === 'tool_changed' ? `Review changed tools from ${origin}` : `Trust tools from ${origin}?`,
        description: 'Tool names and descriptions are supplied by the page. Calls still use normal agent permissions.',
        approveLabel: 'Trust this session',
        alwaysLabel: 'Always trust this site',
        denyLabel: 'Deny',
        items: (payload?.tools ?? []).map((tool) => ({
          title: tool.title || tool.name,
          subtitle: tool.description || (tool.annotations.readOnlyHint === true ? 'Page claims read-only' : 'May change data'),
          warning: tool.changed || tool.annotations.readOnlyHint === false,
        })),
      }
    }
    default:
      return {
        title: `Allow ${genericToolName(request.toolName)}?`,
        description: request.decisionReason || request.blockedPath,
        approveLabel: 'Allow',
        denyLabel: 'Deny',
        alwaysLabel: request.allowAlwaysAllow ? 'Always allow' : undefined,
        items: request.suggestions?.map((suggestion) => ({ title: valueLabel(suggestion) })) ?? [],
      }
  }
}

export function initialElicitationAnswers(fields: ElicitationFormField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? (field.type === 'boolean' ? false : '')]))
}

export function elicitationAnswersAreValid(
  fields: ElicitationFormField[],
  answers: Record<string, unknown>,
): boolean {
  return fields.every((field) => {
    if (!field.required) return true
    const value = answers[field.name]
    return field.type === 'boolean' ? typeof value === 'boolean' : value !== undefined && value !== null && String(value).trim() !== ''
  })
}

export function defaultPermissionFormAnswers(request: PermissionRequest): Record<string, unknown> | undefined {
  switch (request.requestKind) {
    case 'video_gen_confirm':
      return request.videoGenConfirm
        ? { [VIDEO_GEN_PARAMS_FIELD]: JSON.stringify(request.videoGenConfirm.params) }
        : undefined
    case 'config_confirm': {
      const payload = request.configConfirm
      if (!payload) return undefined
      const fields = [...(payload.fields ?? []), ...(payload.resource?.fields ?? [])]
      return { [CONFIG_APPLY_FIELD]: JSON.stringify(Object.fromEntries(fields.map((field) => [field.key, field.proposedValue]))) }
    }
    case 'session_agents_confirm':
      return request.sessionAgentsConfirm
        ? buildCollaborationFormAnswers(request.sessionAgentsConfirm)
        : undefined
    default:
      return undefined
  }
}
