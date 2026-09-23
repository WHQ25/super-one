import {
  resolveLaunchSummary,
  SESSION_AGENT_LAUNCHES_FIELD,
  SESSION_AGENT_TASK_MAX,
  type PermissionMode,
  type SandboxMode,
  type SessionAgentLaunchConfig,
  type SessionAgentLaunchProposal,
  type SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import { CollaborationError } from './errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LABEL_MAX = 64

export const MAX_LAUNCHES_PER_REQUEST = 16

export const EDITABLE_PERMISSION_MODES: ReadonlySet<PermissionMode> = new Set<PermissionMode>([
  'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'agent',
])
export const EDITABLE_SANDBOX_MODES: ReadonlySet<SandboxMode> = new Set<SandboxMode>(['off', 'on', 'auto'])

export function resolveLaunchMode(raw: unknown): SessionCollabLaunchMode {
  if (raw === 'link') return 'link'
  if (raw === 'handoff') return 'handoff'
  return 'spawn'
}

/** A launchId short and human enough to double as a label (not a generated UUID). */
function humanLaunchId(launchId: string | undefined): string | undefined {
  const id = launchId?.trim()
  return id && id.length <= 32 && !UUID_RE.test(id) ? id : undefined
}

/** Prefer explicit role, then human launchId, then a short task-derived label. */
export function deriveCollaborationRole(input: {
  role?: string
  launchId?: string
  task: string
}): string {
  const explicit = input.role?.trim()
  if (explicit) return explicit.slice(0, LABEL_MAX)
  const fromId = humanLaunchId(input.launchId)
  if (fromId) return fromId
  const firstLine = input.task.split(/\n/, 1)[0]?.trim() ?? ''
  const youAre = firstLine.match(/^(?:you are|role)\s*[:\-]?\s*(.+)$/i)
  if (youAre?.[1]) return youAre[1].replace(/[.\s]+$/g, '').slice(0, 40)
  return 'Agent'
}

/** Agent-chosen display name — never the harness brand. */
export function deriveCollaborationName(input: { name?: string; launchId?: string }): string {
  const explicit = input.name?.trim()
  if (explicit) return explicit.slice(0, LABEL_MAX)
  return humanLaunchId(input.launchId) ?? 'Agent'
}

export function collaborationSessionTitle(name: string, role: string): string {
  return `${name.trim() || 'Agent'} - ${role.trim() || 'Agent'}`
}

export function parseGrantConfig<T extends object = SessionAgentLaunchConfig>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return {} as T
  }
}

function invalid(message: string): never {
  throw new CollaborationError(message, 'invalid_argument')
}

function assertLabel(kind: 'name' | 'role', value: string): string {
  if (value.length > LABEL_MAX) invalid(`A launch ${kind} may contain at most ${LABEL_MAX} characters`)
  return value
}

function assertTaskLength(task: string): string {
  if (task.length > SESSION_AGENT_TASK_MAX) {
    invalid(`A launch task may contain at most ${SESSION_AGENT_TASK_MAX.toLocaleString()} characters`)
  }
  return task
}

export function assertLaunchCount(count: number): void {
  if (count === 0) invalid('launches must contain at least one proposed session')
  if (count > MAX_LAUNCHES_PER_REQUEST) {
    invalid(`A single request may contain at most ${MAX_LAUNCHES_PER_REQUEST} launches`)
  }
}

export interface LaunchText {
  task: string
  summary: string
  name: string
  role: string
}

/**
 * Validate the agent-written text of one launch. Link launches default their
 * labels from the existing peer; spawn and handoff must name the new session.
 */
export function normalizeLaunchText(
  mode: SessionCollabLaunchMode,
  launch: { task?: string; summary?: string; name?: string; role?: string },
  linkPeerTitle?: string,
): LaunchText {
  if (mode === 'link') {
    const summary = launch.summary?.trim() || resolveLaunchSummary(launch.task ?? '', launch.summary)
    if (!summary) invalid('Every launch must include a non-empty summary')
    return {
      task: assertTaskLength((launch.task ?? '').trim()),
      summary,
      name: assertLabel('name', launch.name?.trim() || linkPeerTitle || ''),
      role: assertLabel('role', launch.role?.trim() || 'Peer'),
    }
  }
  const task = launch.task?.trim()
  if (!task) invalid(`Every ${mode} launch must include a non-empty task`)
  assertTaskLength(task)
  const summary = resolveLaunchSummary(task, launch.summary)
  if (!summary) invalid('Every launch must include a non-empty summary')
  const name = launch.name?.trim()
  if (!name) invalid(`Every ${mode} launch must include a non-empty name`)
  const role = launch.role?.trim()
  if (!role) invalid(`Every ${mode} launch must include a non-empty role`)
  return { task, summary, name: assertLabel('name', name), role: assertLabel('role', role) }
}

/**
 * Apply the fields a user may edit in the confirm UI. Everything else (agent,
 * task, cwd, worktree, name/role) stays as the agent proposed it.
 */
export function patchEditableLaunchConfig<T extends SessionAgentLaunchConfig>(base: T, rawPatch: unknown): T {
  const patch = (rawPatch && typeof rawPatch === 'object' ? rawPatch : {}) as SessionAgentLaunchConfig
  return {
    ...base,
    ...(typeof patch.model === 'string' && patch.model.trim() ? { model: patch.model.trim() } : {}),
    ...(typeof patch.effort === 'string' && patch.effort.trim() ? { effort: patch.effort.trim() } : {}),
    ...(typeof patch.fastMode === 'boolean' ? { fastMode: patch.fastMode } : {}),
    ...(patch.apiProviderId === null || typeof patch.apiProviderId === 'string'
      ? { apiProviderId: patch.apiProviderId }
      : {}),
    ...(typeof patch.permissionMode === 'string' && EDITABLE_PERMISSION_MODES.has(patch.permissionMode)
      ? { permissionMode: patch.permissionMode }
      : {}),
    ...(typeof patch.sandboxMode === 'string' && EDITABLE_SANDBOX_MODES.has(patch.sandboxMode)
      ? { sandboxMode: patch.sandboxMode }
      : {}),
  }
}

/**
 * Trust only the fields the confirm UI is allowed to edit. The launch set, mode,
 * agent, and text always come from the host-side proposal — never from the
 * confirm answer, which crosses a renderer or remote boundary.
 */
export function mergeConfirmedLaunches(
  proposed: SessionAgentLaunchProposal[],
  content: Record<string, unknown> | undefined,
): SessionAgentLaunchProposal[] {
  const packed = content?.[SESSION_AGENT_LAUNCHES_FIELD]
  if (typeof packed !== 'string') return proposed

  let edited: unknown
  try {
    edited = JSON.parse(packed)
  } catch {
    invalid('The confirmed launch configuration is invalid')
  }
  if (!Array.isArray(edited)) invalid('The confirmed launch configuration is invalid')
  if (edited.length !== proposed.length) {
    invalid('The confirmed request must contain the same launches that were proposed')
  }

  const proposedById = new Map(proposed.map((launch) => [launch.launchId, launch]))
  const seen = new Set<string>()
  return edited.map((raw) => {
    if (!raw || typeof raw !== 'object') invalid('The confirmed launch configuration is invalid')
    const item = raw as Partial<SessionAgentLaunchProposal>
    const launchId = typeof item.launchId === 'string' ? item.launchId : ''
    const base = proposedById.get(launchId)
    if (!base) invalid(`Unknown launchId in confirmed configuration: ${launchId || '(missing)'}`)
    if (seen.has(launchId)) invalid('Confirmed launches must have unique launchIds')
    seen.add(launchId)
    // Link launches have no user-editable config; keep the proposed row intact.
    if (base.mode === 'link') return { ...base, config: { ...base.config } }
    return {
      ...base,
      // A tampered mode could turn a supervised child into a one-way handoff.
      mode: base.mode ?? 'spawn',
      config: patchEditableLaunchConfig(base.config, item.config),
    }
  })
}
