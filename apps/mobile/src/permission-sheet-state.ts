import {
  CONFIG_APPLY_FIELD,
  VIDEO_GEN_PARAMS_FIELD,
  type AgentProfileConfirmChange,
  type AgentProfileConfirmView,
  type ElicitationFormField,
  type PermissionRequest,
  type SessionAgentLaunchConfig,
  type HarnessId,
} from '@superone/shared/agent-types'
import { acpAgentDisplayName } from '@superone/shared/acp-brand'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { HARNESS_PROFILE_OPTIONS } from '@superone/shared/agent-profile-options'
import { schemaFormForResourceHost, type SchemaForm, type SchemaFormField } from '@superone/shared/schema-form'
import { buildCollaborationFormAnswers } from './collaboration-state'
import { permissionModeLabel } from './ui/permission-mode-data'
import { profileLaunchSandboxMode } from '@superone/shared/agent-profile-launch'

export type PermissionSheetItem = {
  title: string
  subtitle?: string
  warning?: boolean
  /** The title is fixed copy (a field label) to translate, not user content. */
  label?: boolean
}

export type PermissionSheetPresentation = {
  title: string
  description?: string
  approveLabel: string
  denyLabel: string
  alwaysLabel?: string
  /** A second remember choice with a shorter lifetime (terminal command rules). */
  sessionLabel?: string
  items: PermissionSheetItem[]
  destructive?: boolean
}

function launchConfigurationItems(config: SessionAgentLaunchConfig, harnessId?: HarnessId, acpAgentId?: string): PermissionSheetItem[] {
  return [
    ...(harnessId === 'acp' ? [{ title: 'ACP agent', label: true, subtitle: acpAgentId ?? 'Unresolved (launch approval required)' }] : []),
    ...(config.model ? [{ title: 'Model', label: true, subtitle: config.model }] : []),
    ...(config.effort ? [{ title: 'Effort', label: true, subtitle: config.effort }] : []),
    { title: 'Permission', label: true, subtitle: config.codexPermissionPreset === 'read-only' ? 'Read-only' : harnessId ? permissionModeLabel(config.permissionMode ?? 'default', harnessId) : config.permissionMode ?? 'default' },
    { title: 'Sandbox', label: true, subtitle: profileLaunchSandboxMode(config, harnessId) },
    { title: 'Provider / account', label: true, subtitle: config.apiProviderId ?? 'Default harness account' },
    ...((config.fastMode ?? config.claudeFastMode) !== undefined ? [{ title: 'Fast mode', label: true, subtitle: (config.fastMode ?? config.claudeFastMode) ? 'On' : 'Off' }] : []),
    ...Object.entries(config.options ?? {}).map(([key, value]) => ({ title: AGENT_PROFILE_FIELD_LABELS[key as keyof typeof AGENT_PROFILE_FIELD_LABELS] ?? key, label: true, subtitle: typeof value === 'object' ? JSON.stringify(value) : String(value) })),
  ]
}

const AGENT_PROFILE_FIELD_LABELS: Record<AgentProfileConfirmChange['field'], string> = {
  name: 'Name',
  description: 'Description',
  instructions: 'Instructions',
  model: 'Model',
  effort: 'Effort',
  permissionMode: 'Permission',
  ultracode: 'Ultracode',
  fastMode: 'Fast mode',
  contextWindow: 'Context window',
  mode: 'Mode',
  agent: 'Agent',
  agentPreset: 'Preset',
  modelParams: 'Model options',
}

/** Host display values arrive as `on` / `off` for toggles; the sheet translates them. */
function agentProfileValue(raw: string | undefined): string | undefined {
  return raw === 'on' ? 'On' : raw === 'off' ? 'Off' : raw
}

/** An update's side as text: permission modes in the harness's own vocabulary. */
function agentProfileChangeValue(
  change: AgentProfileConfirmChange,
  raw: string | undefined,
  payload: { profiles: AgentProfileConfirmView[] } | undefined,
): string | undefined {
  const harnessId = payload?.profiles[0]?.harnessId
  if (change.field === 'permissionMode' && raw && harnessId) return permissionModeLabel(raw, harnessId)
  return agentProfileValue(raw)
}

function agentProfileHarness(profile: AgentProfileConfirmView): string {
  const harness = HARNESS_CAPABILITIES[profile.harnessId]?.displayName ?? profile.harnessId
  return profile.acpAgentId ? `${harness} · ${acpAgentDisplayName(profile.acpAgentId)}` : harness
}

/** The whole profile being approved, the desktop card's fields: instructions included, unset and unsupported fields explicit. */
function agentProfileItems(profile: AgentProfileConfirmView): PermissionSheetItem[] {
  const field = (key: AgentProfileConfirmChange['field'], value: string | undefined, unset = 'User default'): PermissionSheetItem => ({
    title: AGENT_PROFILE_FIELD_LABELS[key],
    label: true,
    subtitle: (profile.unsupported as readonly string[] | undefined)?.includes(key) ? 'Not supported' : value || unset,
  })
  return [
    { title: profile.name, subtitle: [agentProfileHarness(profile), profile.description].filter(Boolean).join(' · ') },
    field('instructions', profile.instructions, 'None'),
    field('model', profile.modelName ?? profile.model),
    field('effort', profile.effort ? formatEffortLabel(profile.effort) : undefined),
    field('permissionMode', profile.permissionMode ? permissionModeLabel(profile.permissionMode, profile.harnessId) : undefined),
    ...HARNESS_PROFILE_OPTIONS[profile.harnessId].map((key) => field(key, agentProfileValue(profile.options?.[key]))),
  ]
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

function suggestionDestination(value: unknown): string {
  const destinations: Record<string, string> = {
    session: 'this session',
    localSettings: 'this folder',
    projectSettings: 'this project',
    userSettings: 'all projects',
    cliArg: 'the CLI',
  }
  return destinations[String(value ?? 'session')] ?? String(value)
}

export function permissionSuggestionLabel(suggestion: Record<string, unknown>): string {
  switch (suggestion.type) {
    case 'setMode':
      return `Switch to ${String(suggestion.mode ?? 'the suggested mode')}`
    case 'addDirectories': {
      const directories = Array.isArray(suggestion.directories) ? suggestion.directories.join(', ') : ''
      return `Allow access to ${directories || 'the suggested directories'} for ${suggestionDestination(suggestion.destination)}`
    }
    case 'addRules': {
      const rules = Array.isArray(suggestion.rules)
        ? suggestion.rules.map((rule) => {
          if (!rule || typeof rule !== 'object') return String(rule)
          const value = rule as Record<string, unknown>
          return value.ruleContent ? `${String(value.toolName ?? '')} (${String(value.ruleContent)})` : String(value.toolName ?? '')
        }).filter(Boolean).join(', ')
        : ''
      return `Allow ${rules || 'the suggested rules'} for ${suggestionDestination(suggestion.destination)}`
    }
    default:
      return valueLabel(suggestion)
  }
}

export function permissionSheetPresentation(request: PermissionRequest): PermissionSheetPresentation {
  switch (request.requestKind) {
    case 'input_request':
      return { title: request.inputRequest?.title ?? request.message ?? 'Input requested', description: request.inputRequest?.description, approveLabel: request.inputRequest?.submitLabel ?? 'Submit', denyLabel: 'Cancel', items: [] }
    case 'mcp_elicitation':
      return {
        title: request.message || `Allow ${request.serverLabel || request.serverName || genericToolName(request.toolName)}?`,
        description: request.subtitle || 'The connected tool needs more information before it can continue.',
        approveLabel: 'Continue',
        denyLabel: 'Decline',
        // A remembered answer belongs to an approval, never to a form's input.
        alwaysLabel: request.supportsAlwaysPersist && !permissionSchemaForm(request) ? 'Continue & remember' : undefined,
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
      // Fixed title per kind — the subject goes into the item list so a long app name
      // never wraps the sheet header.
      return {
        title: 'Allow app control?',
        description: 'Computer Use can observe and interact with this desktop app for the current session.',
        approveLabel: 'Allow',
        denyLabel: 'Deny',
        alwaysLabel: request.allowAlwaysAllow ? 'Always allow' : undefined,
        items: [
          { title: app, subtitle: grant?.bundleId || 'Application' },
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
    case 'agent_profile_confirm': {
      const payload = request.agentProfileConfirm
      const operation = payload?.operation ?? 'update'
      return {
        title: operation === 'delete' ? 'Delete agents?' : operation === 'create' ? 'Create agent?' : 'Update agent?',
        description: operation === 'delete'
          ? 'Sessions already started on them continue on the built-in agent of their harness.'
          : payload?.collaborationApproval ? 'Allow future collaboration with this Profile and the configuration below in the same project, including branch/detached worktrees without copying local changes. Other configurations still ask. Delete the Profile to revoke approval.' : 'Review the agent before saving. It is offered for delegation once saved.',
        approveLabel: operation === 'delete' ? 'Delete' : 'Save agent',
        denyLabel: 'Cancel',
        destructive: operation === 'delete',
        items: payload?.collaborationApproval ? [
          ...(payload.profiles ?? []).flatMap(agentProfileItems),
          ...launchConfigurationItems(payload.collaborationApproval.config, payload.profiles[0]?.harnessId, payload.profiles[0]?.acpAgentId),
        ] : operation === 'update'
          ? (payload?.changes ?? []).map((change) => ({
            title: AGENT_PROFILE_FIELD_LABELS[change.field],
            label: true,
            subtitle: `${agentProfileChangeValue(change, change.from, payload) || '—'} → ${agentProfileChangeValue(change, change.to, payload) || '—'}`,
          }))
          : operation === 'create'
            ? (payload?.profiles ?? []).flatMap(agentProfileItems)
            : (payload?.profiles ?? []).map((profile) => ({
              title: profile.name,
              subtitle: [agentProfileHarness(profile), profile.description].filter(Boolean).join(' · '),
            })),
      }
    }
    case 'webmcp_trust_confirm': {
      const payload = request.webmcpTrustConfirm
      const origin = payload?.origin || String(request.input.origin || 'this site')
      return {
        title: payload?.reason === 'tool_changed' ? 'Review changed site tools?' : 'Trust site tools?',
        description: `${origin} — tool names and descriptions are supplied by the page. Calls still use normal agent permissions.`,
        approveLabel: 'Trust',
        alwaysLabel: 'Always trust',
        denyLabel: 'Deny',
        items: (payload?.tools ?? []).map((tool) => ({
          title: tool.title || tool.name,
          subtitle: tool.description || (tool.annotations.readOnlyHint === true ? 'Page claims read-only' : 'May change data'),
          warning: tool.changed || tool.annotations.readOnlyHint === false,
        })),
      }
    }
    case 'device_control_confirm': {
      const device = String(request.input.device || 'this device')
      const platform = typeof request.input.platform === 'string' ? request.input.platform : undefined
      const reason = typeof request.input.description === 'string' ? request.input.description : undefined
      const note = typeof request.input.note === 'string' ? request.input.note : undefined
      // `request.message` is the desktop's one-line question with the device and reason
      // folded in; on a phone that wraps to three lines, so the title stays fixed and
      // the device / reason render in the body.
      return {
        title: 'Allow device control?',
        description: [reason || 'SuperOne can observe and interact with this device for the current session.', note].filter(Boolean).join(' '),
        approveLabel: 'Allow',
        alwaysLabel: request.allowAlwaysAllow ? 'Always allow' : undefined,
        denyLabel: 'Deny',
        items: [
          { title: device, subtitle: platform || 'Device', warning: Boolean(note) },
        ],
      }
    }
    case 'terminal_command_confirm': {
      const action = request.input.action === 'attach' ? 'attach' : request.input.action === 'close' ? 'close' : 'run'
      const command = String(request.input.command || '')
      const cwd = typeof request.input.cwd === 'string' ? request.input.cwd : undefined
      const reason = typeof request.input.description === 'string' ? request.input.description : undefined
      const rule = typeof request.input.rule === 'string' ? request.input.rule : undefined
      // Mirrors the desktop prompt: the command is the subject, so it lives in the
      // item list, and the regex rule can be kept for this session or for the project.
      return {
        title: action === 'attach' ? 'Attach to running command?' : action === 'close' ? 'Close terminal tab?' : 'Run in a terminal tab?',
        description: [
          reason,
          action === 'close'
            ? 'The tab was opened by you; the agent wants to close it.'
            : 'The agent controls the tab only while this command runs.',
          rule && request.allowAlwaysAllow ? `Remembering keeps the rule ${rule} (a regular expression over the command) for this session or for this project.` : undefined,
        ].filter(Boolean).join(' '),
        approveLabel: 'Allow',
        alwaysLabel: request.allowAlwaysAllow ? 'Always allow' : undefined,
        sessionLabel: request.allowAlwaysAllow ? 'Allow for session' : undefined,
        denyLabel: 'Deny',
        items: [{ title: command, subtitle: cwd || 'Terminal' }],
      }
    }
    case 'folder_trust': {
      const workspace = typeof request.input.workspace === 'string' ? request.input.workspace : undefined
      const cwd = typeof request.input.cwd === 'string' ? request.input.cwd : undefined
      const kinds = Array.isArray(request.input.configKinds)
        ? request.input.configKinds.filter((kind): kind is string => typeof kind === 'string')
        : []
      return {
        title: 'Trust this folder?',
        description: 'Grok loads project rules, MCP servers, hooks, and skills only after you trust the folder.',
        approveLabel: 'Trust',
        denyLabel: 'Don\'t trust',
        items: [
          ...(workspace ? [{ title: workspace, subtitle: 'Workspace' }] : []),
          ...(cwd && cwd !== workspace ? [{ title: cwd, subtitle: 'Directory' }] : []),
          { title: kinds.length ? kinds.join(', ') : 'No project config kinds were listed.', subtitle: 'Config' },
        ],
      }
    }
    default:
      return {
        title: `Allow ${genericToolName(request.toolName)}?`,
        description: request.decisionReason || request.blockedPath,
        approveLabel: 'Allow',
        denyLabel: 'Deny',
        alwaysLabel: request.allowAlwaysAllow ? 'Always allow' : undefined,
        items: [],
      }
  }
}

/**
 * The form an elicitation asks for. Desktops that predate `schemaForm` send only
 * the flat legacy list, which maps onto the same model so one renderer serves both.
 */
export function permissionSchemaForm(request: Pick<PermissionRequest, 'schemaForm' | 'elicitationForm'>): SchemaForm | undefined {
  if (request.schemaForm) return schemaFormForResourceHost(request.schemaForm, false)
  if (!request.elicitationForm?.length) return undefined
  return { supported: true, fields: request.elicitationForm.map(legacySchemaFormField) }
}

function legacySchemaFormField(field: ElicitationFormField): SchemaFormField {
  const base = { name: field.name, label: field.label, required: field.required, ...(field.description ? { description: field.description } : {}) }
  const def = field.defaultValue
  switch (field.type) {
    case 'enum': return { ...base, kind: 'select', options: (field.enumOptions ?? []).map((value) => ({ value, label: value })), ...(typeof def === 'string' ? { default: def } : {}) }
    case 'number': return { ...base, kind: 'number', integer: false, ...(typeof def === 'number' ? { default: def } : {}) }
    case 'boolean': return { ...base, kind: 'boolean', ...(typeof def === 'boolean' ? { default: def } : {}) }
    case 'string': return { ...base, kind: 'text', ...(typeof def === 'string' ? { default: def } : {}) }
  }
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
