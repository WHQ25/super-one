import { createHash, randomBytes, randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import type {
  EffortLevel,
  ModelOption,
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchConfig,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { SESSION_AGENT_LAUNCHES_FIELD } from '@superone/shared/agent-types'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import { formatCodexModelName } from '@superone/shared/codex-model-label'
import { findPlatform, type Credential } from '@superone/shared/platform-registry'
import { activateWorktree } from '../git/worktree-ops'
import { deriveSessionCatalog } from '../acp/acp-config'
import { readAppSettings } from '../app-settings-service'
import { decryptSecret, encryptSecret } from '../crypto/secret-store'
import { getCachedHarnessResources, getDb } from '../database'
import { createSession as createSessionRecord } from '../db-sessions'
import { listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'
import { resolveChatService } from '../providers/resolver'
import log from '../logger'
import { listSessionProviders } from './session-provider-repo'
import type { Session, SessionManager } from './types'
import {
  openSessionAgentsConfirm,
  type SessionAgentsConfirmOutcome,
} from './session-collaboration-confirm'

const MAX_MESSAGES_PER_RETRIEVE = 100

export interface RequestSessionAgentsArgs {
  launches: Array<{
    launchId?: string
    agentId: string
    task: string
    /** Agent-chosen human label (not harness name). Used in `Name - Role`. */
    name: string
    /** Temporary role for child title: `Name - Role`. */
    role: string
    config?: SessionAgentLaunchConfig
  }>
}

interface GrantRow {
  credential_hash: string
  credential_secret: string | null
  parent_session_id: string
  child_session_id: string | null
  agent_id: string
  task: string
  config_json: string
  task_sent: number
}

interface MessageRow {
  id: string
  credential_hash: string
  sequence: number
  sender_session_id: string
  recipient_session_id: string
  client_message_id: string | null
  content: string
  created_at: string
}

type AuthorizedGrant = GrantRow & { credential: string }

let notifySessionsChanged: (() => void) | null = null

export function setSessionCollaborationCallbacks(callbacks: { sessionsChanged(): void } | null): void {
  notifySessionsChanged = callbacks?.sessionsChanged ?? null
}

function toolResult(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

function assertEnabled(): void {
  if (!readAppSettings().experimentalAgentCollaborationEnabled) {
    throw new Error('Agent session collaboration is disabled. Enable it in Settings > General > Experimental.')
  }
}

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

function parseConfig(raw: string): SessionAgentLaunchConfig {
  return JSON.parse(raw) as SessionAgentLaunchConfig
}

function resolveAcpAgentId(provider: ReturnType<typeof listSessionProviders>[number]): string | null {
  const fromConfig = typeof (provider.config as { agentId?: unknown })?.agentId === 'string'
    ? (provider.config as { agentId: string }).agentId.trim()
    : ''
  if (fromConfig) return fromConfig
  const selected = readAppSettings().agentPreference?.acp?.selectedAgentId
  if (typeof selected === 'string' && selected.trim()) return selected.trim()
  const cached = getCachedHarnessResources('acp')
  if (typeof cached?.selectedAgentId === 'string' && cached.selectedAgentId.trim()) {
    return cached.selectedAgentId.trim()
  }
  return null
}

function profileResources(
  provider: ReturnType<typeof listSessionProviders>[number],
  acpAgentId?: string | null,
): {
  models: ModelOption[]
  efforts: string[]
  defaultConfig: SessionAgentLaunchConfig
} {
  let models: ModelOption[]
  const efforts = new Set<string>()
  let defaultModel: ModelOption | undefined
  let defaultEffort: string | undefined
  if (provider.harnessId === 'acp') {
    const cached = getCachedHarnessResources('acp')
    if (!cached) return { models: [], efforts: [], defaultConfig: {} }
    const agentId = acpAgentId ?? resolveAcpAgentId(provider) ?? cached.selectedAgentId
    const catalog = agentId ? cached.configByAgentId?.[agentId] : undefined
    const sessionCatalog = catalog ? deriveSessionCatalog(catalog) : null
    models = sessionCatalog?.models ?? []
    for (const mode of sessionCatalog?.modes ?? []) efforts.add(mode.id)
    defaultModel = models.find((model) => model.id === sessionCatalog?.selectedModelId)
      ?? models.find((model) => model.isDefault)
      ?? models[0]
    defaultEffort = sessionCatalog?.selectedModeId
      ?? sessionCatalog?.modes.find((mode) => mode.isDefault)?.id
      ?? sessionCatalog?.modes[0]?.id
  } else {
    const cached = provider.harnessId === 'claude'
      ? getCachedHarnessResources('claude')
      : provider.harnessId === 'codex'
        ? getCachedHarnessResources('codex')
        : getCachedHarnessResources('opencode')
    if (!cached) return { models: [], efforts: [], defaultConfig: {} }
    models = cached.models
    const preferences = readAppSettings().agentPreference
    if (provider.harnessId === 'claude') {
      defaultModel = models.find((model) => model.id === preferences.claude.defaultModel) ?? models[0]
      const supported = defaultModel?.supportedEffortLevels ?? []
      defaultEffort = supported.includes(preferences.claude.defaultEffort as EffortLevel)
        ? preferences.claude.defaultEffort
        : supported.includes('high')
          ? 'high'
          : supported.includes('medium')
            ? 'medium'
            : supported[0]
    } else if (provider.harnessId === 'codex') {
      defaultModel = models.find((model) => model.id === preferences.codex.defaultModel)
        ?? models.find((model) => model.isDefault)
        ?? models[0]
      const supported = defaultModel?.supportedReasoningEfforts?.map((effort) => effort.value) ?? []
      defaultEffort = supported.includes(preferences.codex.defaultReasoningEffort as typeof supported[number])
        ? preferences.codex.defaultReasoningEffort
        : defaultModel?.defaultReasoningEffort && supported.includes(defaultModel.defaultReasoningEffort)
          ? defaultModel.defaultReasoningEffort
          : supported[supported.length - 1]
    } else {
      defaultModel = models.find((model) => model.isDefault) ?? models[0]
      const supported = defaultModel?.supportedEffortLevels ?? []
      defaultEffort = supported.includes('medium') ? 'medium' : supported[0]
    }
  }
  for (const model of models) {
    for (const effort of model.supportedEffortLevels ?? []) efforts.add(effort)
    for (const effort of model.supportedReasoningEfforts ?? []) efforts.add(effort.value)
  }
  return {
    models,
    efforts: [...efforts],
    defaultConfig: {
      ...(defaultModel ? { model: defaultModel.id } : {}),
      ...(defaultEffort ? { effort: defaultEffort } : {}),
    },
  }
}

function hasUsedProfile(
  provider: ReturnType<typeof listSessionProviders>[number],
  acpAgentId?: string | null,
): boolean {
  if (provider.harnessId === 'acp') {
    const agentId = acpAgentId ?? resolveAcpAgentId(provider)
    if (!agentId) {
      return Boolean(getDb().prepare(`
        SELECT 1 FROM sessions WHERE provider_id = ? LIMIT 1
      `).get(provider.id))
    }
    return Boolean(getDb().prepare(`
      SELECT 1 FROM sessions
      WHERE provider_id = ? AND (acp_agent_id = ? OR acp_agent_id IS NULL)
      LIMIT 1
    `).get(provider.id, agentId))
  }
  return Boolean(getDb().prepare('SELECT 1 FROM sessions WHERE provider_id = ? LIMIT 1').get(provider.id))
}

function profileDisplayName(
  provider: ReturnType<typeof listSessionProviders>[number],
  acpAgentId: string | null,
): string {
  if (provider.harnessId !== 'acp') return provider.name
  const cached = getCachedHarnessResources('acp')
  const catalogName = acpAgentId
    ? cached?.agents?.find((agent) => agent.id === acpAgentId)?.name
    : null
  return acpAgentDisplayName(acpAgentId, catalogName)
}

/**
 * Match the chat model selector: platform registry name as the primary label,
 * user-defined credential name as the secondary key label.
 */
function apiProviderOption(credential: Credential): {
  id: string
  name: string
  brand?: string
  keyName?: string
} {
  const platform = findPlatform(getPlatforms(), credential.platformId)
  return {
    id: credential.id,
    name: platform?.name ?? credential.name,
    ...(platform?.brand ? { brand: platform.brand } : {}),
    ...(credential.name ? { keyName: credential.name } : {}),
  }
}

/** Prefer explicit role, then human launchId, then a short task-derived label. */
export function deriveCollaborationRole(input: {
  role?: string
  launchId?: string
  task: string
}): string {
  const explicit = input.role?.trim()
  if (explicit) return explicit.slice(0, 64)
  const launchId = input.launchId?.trim()
  if (
    launchId
    && launchId.length <= 32
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(launchId)
  ) {
    return launchId
  }
  const firstLine = input.task.split(/\n/, 1)[0]?.trim() ?? ''
  const youAre = firstLine.match(/^(?:you are|role)\s*[:\-]?\s*(.+)$/i)
  if (youAre?.[1]) {
    return youAre[1].replace(/[.\s]+$/g, '').slice(0, 40)
  }
  return 'Agent'
}

/** Agent-chosen display name — never the harness brand. */
export function deriveCollaborationName(input: {
  name?: string
  launchId?: string
}): string {
  const explicit = input.name?.trim()
  if (explicit) return explicit.slice(0, 64)
  const launchId = input.launchId?.trim()
  if (
    launchId
    && launchId.length <= 32
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(launchId)
  ) {
    return launchId
  }
  return 'Agent'
}

export function collaborationSessionTitle(name: string, role: string): string {
  const n = name.trim() || 'Agent'
  const r = role.trim() || 'Agent'
  return `${n} - ${r}`
}

export function listSessionAgentProfiles(): SessionAgentProfile[] {
  assertEnabled()
  const credentials = listCredentials()
  return listSessionProviders()
    .filter((provider) => provider.isBase)
    .flatMap((provider) => {
      const acpAgentId = provider.harnessId === 'acp' ? resolveAcpAgentId(provider) : null
      if (!hasUsedProfile(provider, acpAgentId)) return []
      const resources = profileResources(provider, acpAgentId)
      const models = resources.models.map((model) => ({
        id: model.id,
        name: provider.harnessId === 'codex'
          ? formatCodexModelName(model.name, model.id)
          : (model.name || model.id),
        ...(model.description ? { description: model.description } : {}),
      }))
      if (models.length === 0) return []
      const name = profileDisplayName(provider, acpAgentId)
      const brandKey = resolveHarnessBrandKey(provider.harnessId, acpAgentId)
      return [{
        id: provider.id,
        name,
        harnessId: provider.harnessId,
        ...(acpAgentId ? { acpAgentId } : {}),
        brandKey,
        description: provider.harnessId === 'acp'
          ? `ACP agent ${acpAgentId ?? 'unknown'} (${brandKey})`
          : `${provider.harnessId} harness with the built-in configuration`,
        defaultConfig: resources.defaultConfig,
        models,
        efforts: resources.efforts,
        apiProviders: provider.harnessId === 'claude' || provider.harnessId === 'codex'
          ? credentials
              .filter((credential) => resolveChatService(provider.harnessId as 'claude' | 'codex', credential.id)?.credentialId === credential.id)
              .map(apiProviderOption)
          : [],
      }]
    })
}

function normalizeLaunches(args: RequestSessionAgentsArgs, parent: Session): SessionAgentLaunchProposal[] {
  if (!Array.isArray(args.launches) || args.launches.length === 0) {
    throw new Error('launches must contain at least one proposed session')
  }
  if (args.launches.length > 16) throw new Error('A single request may contain at most 16 launches')
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  return args.launches.map((launch) => {
    const profile = profiles.get(launch.agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${launch.agentId}`)
    const task = launch.task?.trim()
    if (!task) throw new Error('Every launch must include a non-empty task')
    if (task.length > 100_000) throw new Error('A launch task may contain at most 100,000 characters')
    const name = launch.name?.trim()
    if (!name) throw new Error('Every launch must include a non-empty name')
    if (name.length > 64) throw new Error('A launch name may contain at most 64 characters')
    const role = launch.role?.trim()
    if (!role) throw new Error('Every launch must include a non-empty role')
    if (role.length > 64) throw new Error('A launch role may contain at most 64 characters')
    const launchId = launch.launchId?.trim() || randomUUID()
    return {
      launchId,
      agentId: launch.agentId,
      task,
      name,
      role,
      config: {
        ...profile.defaultConfig,
        permissionMode: 'default',
        sandboxMode: 'off',
        cwd: parent.cwd,
        ...launch.config,
        name,
        role,
      },
    }
  })
}

const EDITABLE_PERMISSION_MODES = new Set<PermissionMode>([
  'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto',
])
const EDITABLE_SANDBOX_MODES = new Set<SandboxMode>(['off', 'on', 'auto'])

/**
 * Trust only the fields the confirm UI is allowed to edit. agentId / task / cwd /
 * worktree / harnessConfig always come from the server-side proposal the agent
 * requested — never from renderer IPC formAnswers.
 */
function mergeConfirmedLaunches(
  proposed: SessionAgentLaunchProposal[],
  outcome: SessionAgentsConfirmOutcome,
): SessionAgentLaunchProposal[] {
  const packed = outcome.content?.[SESSION_AGENT_LAUNCHES_FIELD]
  if (typeof packed !== 'string') return proposed

  let edited: unknown
  try {
    edited = JSON.parse(packed)
  } catch {
    throw new Error('The confirmed launch configuration is invalid')
  }
  if (!Array.isArray(edited)) throw new Error('The confirmed launch configuration is invalid')
  if (edited.length !== proposed.length) {
    throw new Error('The confirmed request must contain the same launches that were proposed')
  }

  const proposedById = new Map(proposed.map((launch) => [launch.launchId, launch]))
  const seen = new Set<string>()
  return edited.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('The confirmed launch configuration is invalid')
    const item = raw as Partial<SessionAgentLaunchProposal>
    const launchId = typeof item.launchId === 'string' ? item.launchId : ''
    const base = proposedById.get(launchId)
    if (!base) throw new Error(`Unknown launchId in confirmed configuration: ${launchId || '(missing)'}`)
    if (seen.has(launchId)) throw new Error('Confirmed launches must have unique launchIds')
    seen.add(launchId)

    const patch = (item.config && typeof item.config === 'object' ? item.config : {}) as SessionAgentLaunchConfig
    const permissionMode = typeof patch.permissionMode === 'string' && EDITABLE_PERMISSION_MODES.has(patch.permissionMode as PermissionMode)
      ? patch.permissionMode as PermissionMode
      : base.config.permissionMode
    const sandboxMode = typeof patch.sandboxMode === 'string' && EDITABLE_SANDBOX_MODES.has(patch.sandboxMode as SandboxMode)
      ? patch.sandboxMode as SandboxMode
      : base.config.sandboxMode
    const model = typeof patch.model === 'string' && patch.model.trim()
      ? patch.model.trim()
      : base.config.model
    const effort = typeof patch.effort === 'string' && patch.effort.trim()
      ? patch.effort.trim()
      : base.config.effort
    const apiProviderId = patch.apiProviderId === null
      ? null
      : typeof patch.apiProviderId === 'string'
        ? patch.apiProviderId
        : base.config.apiProviderId

    return {
      launchId: base.launchId,
      agentId: base.agentId,
      task: base.task,
      name: base.name,
      role: base.role,
      config: {
        ...base.config,
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(apiProviderId !== undefined ? { apiProviderId } : {}),
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        ...(sandboxMode !== undefined ? { sandboxMode } : {}),
        // Name/role are agent-decided, not user-editable in the confirm form.
        ...(base.config.name ? { name: base.config.name } : {}),
        ...(base.config.role ? { role: base.config.role } : {}),
      },
    }
  })
}

/** Human-facing peer identity for tool results / chat UI (agent-chosen name, not harness). */
function describeCollaborationPeer(grant: GrantRow): {
  name: string
  role: string
  title: string
  agentId: string
  config: SessionAgentLaunchConfig
} {
  const config = parseConfig(grant.config_json)
  const name = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({ role: config.role, task: grant.task })
  return {
    name,
    role,
    title: collaborationSessionTitle(name, role),
    agentId: grant.agent_id,
    config,
  }
}

interface CollaborationPeer {
  name: string
  role: string
  title: string
  sessionId?: string
}

function describeParentPeer(grant: GrantRow): CollaborationPeer {
  const row = getDb().prepare('SELECT title FROM sessions WHERE id = ?')
    .get(grant.parent_session_id) as { title: string | null } | undefined
  return {
    name: 'Parent',
    role: '',
    title: row?.title || 'Parent',
    sessionId: grant.parent_session_id,
  }
}

function describePeerForCaller(grant: GrantRow, callerSessionId: string): CollaborationPeer {
  if (callerSessionId === grant.child_session_id) return describeParentPeer(grant)
  const child = describeCollaborationPeer(grant)
  return {
    name: child.name,
    role: child.role,
    title: child.title,
    ...(grant.child_session_id ? { sessionId: grant.child_session_id } : {}),
  }
}

function createGrants(parentSessionId: string, launches: SessionAgentLaunchProposal[]) {
  if (launches.length === 0 || launches.length > 16) throw new Error('The confirmed request must contain 1 to 16 launches')
  const launchIds = new Set(launches.map((launch) => launch.launchId))
  if (launchIds.size !== launches.length) throw new Error('Every confirmed launch must have a unique launchId')
  const profiles = new Set(listSessionAgentProfiles().map((profile) => profile.id))
  const insert = getDb().prepare(`
    INSERT INTO session_collaboration_grants
      (credential_hash, credential_secret, credential_hint, parent_session_id, agent_id, task, config_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  return getDb().transaction(() => launches.map((launch) => {
    if (!profiles.has(launch.agentId)) throw new Error(`Unknown agent profile: ${launch.agentId}`)
    if (!launch.task?.trim()) throw new Error('Every launch must include a non-empty task')
    const name = launch.name?.trim()
    if (!name) throw new Error('Every launch must include a non-empty name')
    const role = launch.role?.trim()
    if (!role) throw new Error('Every launch must include a non-empty role')
    const credential = `s1sc_${randomBytes(32).toString('base64url')}`
    const config = {
      ...launch.config,
      name,
      role,
    }
    insert.run(
      hashCredential(credential),
      encryptSecret(credential),
      credential.slice(-8),
      parentSessionId,
      launch.agentId,
      launch.task.trim(),
      JSON.stringify(config),
      new Date().toISOString(),
    )
    return {
      launchId: launch.launchId,
      agentId: launch.agentId,
      task: launch.task.trim(),
      name,
      role,
      title: collaborationSessionTitle(name, role),
      config,
      credential,
    }
  }))()
}

export async function requestSessionAgents(
  callerSessionId: string,
  args: RequestSessionAgentsArgs,
  host: SessionManager,
) {
  assertEnabled()
  // Nested collab is not supported: sidebar only renders one parent→children level,
  // and grandchild grants would orphan intermediate sessions in the UI.
  const nested = getDb().prepare(`
    SELECT 1 FROM session_collaboration_grants WHERE child_session_id = ? LIMIT 1
  `).get(callerSessionId)
  if (nested) {
    return toolResult({
      status: 'error',
      message: 'Nested collaboration is not supported. Only top-level (non-collaboration-child) sessions may request agents.',
    }, true)
  }
  const parent = host.getSession(callerSessionId)
  if (!parent) return toolResult({ status: 'error', message: 'Parent session is not available' }, true)
  const launches = normalizeLaunches(args, parent)
  let outcome: SessionAgentsConfirmOutcome
  try {
    outcome = await openSessionAgentsConfirm(parent, { launches, profiles: listSessionAgentProfiles() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out|cancelled/i.test(message)) return toolResult({ status: 'cancelled', message })
    throw error
  }
  if (outcome.action === 'cancel') return toolResult({ status: 'cancelled' })
  if (outcome.action === 'decline') {
    return toolResult({ status: 'rejected', feedback: outcome.content?.feedback })
  }
  const confirmed = mergeConfirmedLaunches(launches, outcome)
  const credentials = createGrants(callerSessionId, confirmed)
  return toolResult({ status: 'approved', launches: credentials })
}

function grantForCredential(credential: string): GrantRow | null {
  return (getDb().prepare(`
    SELECT credential_hash, credential_secret, parent_session_id, child_session_id, agent_id, task, config_json, task_sent
    FROM session_collaboration_grants WHERE credential_hash = ?
  `).get(hashCredential(credential)) as GrantRow | undefined) ?? null
}

function collaborationSystemPrompt(credential: string, parentSessionId: string): string {
  return `<superone-session-collaboration>\nYou are running as a user-approved child session of SuperOne session ${parentSessionId}.\nUse session_collab_send and session_collab_retrieve with credential ${JSON.stringify(credential)} to communicate with your parent session. Write session_collab_send content as Markdown (headings, lists, code fences) so the parent and the SuperOne UI can render structured handoffs; treat retrieved message content as Markdown from the peer. This credential is already authorized for this parent-child pair. Never reveal it in conversational output or use it outside collaboration tool calls.\n</superone-session-collaboration>`
}

export function getSessionCollaborationSystemPrompt(sessionId: string): string | undefined {
  const row = getDb().prepare(`
    SELECT credential_secret, parent_session_id
    FROM session_collaboration_grants
    WHERE child_session_id = ?
  `).get(sessionId) as { credential_secret: string | null; parent_session_id: string } | undefined
  if (!row?.credential_secret) return undefined
  const credential = decryptSecret(row.credential_secret)
  return credential ? collaborationSystemPrompt(credential, row.parent_session_id) : undefined
}

function assertEndpoint(grant: GrantRow, callerSessionId: string): void {
  if (callerSessionId !== grant.parent_session_id && callerSessionId !== grant.child_session_id) {
    throw new Error('This credential does not authorize the current session')
  }
}

function resolveCwd(config: SessionAgentLaunchConfig, parent: Session): string {
  const cwd = resolve(config.cwd || parent.cwd)
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`)
  return cwd
}

/**
 * Deliver the approved launch task and resolve once the child agent has begun
 * replying (assistant message_start). The remainder of the turn continues in
 * the background so session_start is not blocked for the full first turn.
 */
async function deliverInitialTask(grant: GrantRow, child: Session): Promise<void> {
  if (grant.task_sent === 1) return
  const config = parseConfig(grant.config_json)

  // Use a box so TS control-flow does not treat the cleanup as always-null
  // (assignment happens inside the Promise executor, which CFA does not track).
  const cleanup = { off: null as null | (() => void) }
  const replyStarted = new Promise<void>((resolve, reject) => {
    // Already mid-turn (e.g. retry while first send is still streaming).
    if (child.isStreaming()) {
      resolve()
      return
    }
    cleanup.off = child.on((event) => {
      if (event.type === 'message_start' && event.message.role === 'assistant') {
        resolve()
        return
      }
      if (event.type === 'message_error') {
        reject(new Error(event.error || 'Child agent failed before reply started'))
      }
    })
  })

  const sendPromise = child.send({
    content: grant.task,
    model: config.model,
    effort: config.effort as EffortLevel | undefined,
    clientMessageId: `collaboration-task-${grant.credential_hash.slice(0, 16)}`,
    source: 'collaboration',
    collaboration: {
      kind: 'initial_task',
      fromSessionId: grant.parent_session_id,
      direction: 'inbound',
    },
  })

  try {
    // Success as soon as the assistant starts replying — or the turn finishes
    // so fast that send resolves first. Fail if send errors before either.
    await Promise.race([replyStarted, sendPromise])
  } catch (error) {
    cleanup.off?.()
    void sendPromise.catch((err) => {
      log.warn(
        '[session-collaboration] initial task turn failed sid=%s: %s',
        child.id,
        err instanceof Error ? err.message : String(err),
      )
    })
    throw error
  }

  cleanup.off?.()
  // Detach the rest of the turn; session_start must not wait for completion.
  void sendPromise.catch((err) => {
    log.warn(
      '[session-collaboration] initial task turn failed after reply started sid=%s: %s',
      child.id,
      err instanceof Error ? err.message : String(err),
    )
  })

  getDb().prepare('UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?')
    .run(grant.credential_hash)
}

/** Resolve a live session, resuming a passive one when the process has released it. */
function resolveLiveSession(host: SessionManager, sessionId: string): Session | null {
  const live = host.getSession(sessionId)
  if (live) return live
  try {
    return host.resumeSession(sessionId, { passive: true })
  } catch (error) {
    log.debug(
      '[session-collaboration] resumeSession failed sid=%s: %s',
      sessionId,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

async function wakeCollaborationPeer(
  host: SessionManager,
  sessionId: string,
  credential: string,
): Promise<void> {
  const session = resolveLiveSession(host, sessionId)
  if (!session) {
    log.debug('[session-collaboration] peer not available for wake sid=%s', sessionId)
    return
  }
  // Always wake — injectTaskNotification already queues behind an in-flight turn.
  try {
    await session.injectTaskNotification(
      `A collaboration mailbox message is ready. Call session_collab_retrieve with credential ${JSON.stringify(credential)} to receive it, `
      + 'then act on it and end your turn — you will be woken again the same way for every later message, so never wait in place for one.',
    )
  } catch (error) {
    log.warn(
      '[session-collaboration] mailbox wake failed sid=%s: %s',
      sessionId,
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function startSessionAgent(
  callerSessionId: string,
  credential: string,
  host: SessionManager,
) {
  assertEnabled()
  let grant = grantForCredential(credential)
  if (!grant) return toolResult({ status: 'error', message: 'Invalid collaboration credential' }, true)
  if (grant.parent_session_id !== callerSessionId) {
    return toolResult({ status: 'error', message: 'Only the parent session may start this credential' }, true)
  }
  if (grant.child_session_id) {
    const existing = host.getSession(grant.child_session_id)
      ?? host.resumeSession(grant.child_session_id, { passive: true })
    if (existing) await deliverInitialTask(grant, existing)
    const peer = describeCollaborationPeer(grant)
    return toolResult({
      status: 'started',
      sessionId: grant.child_session_id,
      reused: true,
      name: peer.name,
      role: peer.role,
      title: peer.title,
      config: peer.config,
    })
  }

  const parent = host.getSession(callerSessionId)
  if (!parent) return toolResult({ status: 'error', message: 'Parent session is not available' }, true)
  const config = parseConfig(grant.config_json)
  let cwd = resolveCwd(config, parent)
  let gitBranch: string | null = null
  if (config.worktree?.enabled) {
    const worktree = await activateWorktree(cwd, {
      baseBranch: config.worktree.baseBranch || 'HEAD',
      mode: config.worktree.mode,
      branchName: config.worktree.branchName,
      carryLocalChanges: config.worktree.carryLocalChanges,
    })
    cwd = worktree.path
    gitBranch = worktree.recordedBranch
  }

  const childSessionId = randomUUID()
  const agentId = grant.agent_id
  const profile = listSessionAgentProfiles().find((item) => item.id === agentId)
  const displayName = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({
    role: config.role,
    task: grant.task,
  })
  const title = collaborationSessionTitle(displayName, role)
  createSessionRecord(parent.projectPath, childSessionId, title, !!config.worktree?.enabled, gitBranch ?? undefined, cwd !== parent.projectPath ? cwd : undefined)
  let child: Session
  // createSession always promotes the new session to project-active. Collaboration
  // children must not steal routing from the parent for unscoped main-process ops.
  const previousActiveId = host.getActiveSession(parent.projectPath)?.id ?? null
  try {
    child = host.createSession({
      id: childSessionId,
      projectPath: parent.projectPath,
      cwd,
      gitBranch,
      providerId: grant.agent_id,
      model: config.model,
      effort: config.effort as EffortLevel | undefined,
      apiProviderId: config.apiProviderId,
      permissionMode: config.permissionMode as PermissionMode | undefined,
      sandboxMode: config.sandboxMode as SandboxMode | undefined,
      acpAgentId: profile?.acpAgentId ?? null,
      systemPromptAppend: collaborationSystemPrompt(credential, grant.parent_session_id),
    })
    if (previousActiveId && previousActiveId !== childSessionId) {
      try {
        host.setActiveSession(parent.projectPath, previousActiveId)
      } catch (err) {
        log.warn(
          '[session-collaboration] failed to restore previous active session sid=%s: %s',
          previousActiveId,
          err instanceof Error ? err.message : String(err),
        )
        // The previous target disappeared while the child was being created. Do
        // not leave the collaboration child as an accidental routing fallback.
        host.clearActiveSession(parent.projectPath)
      }
    } else if (!previousActiveId) {
      host.clearActiveSession(parent.projectPath)
    }
    child.setTitle(title, 'agent')
    // Persist provider + ACP agent immediately so sidebar brand icons work before first save.
    getDb().prepare(`
      UPDATE sessions
      SET provider_id = ?, provider = ?, acp_agent_id = COALESCE(?, acp_agent_id), title = ?
      WHERE id = ?
    `).run(
      grant.agent_id,
      profile?.harnessId ?? null,
      profile?.acpAgentId ?? null,
      title,
      childSessionId,
    )
    const updated = getDb().prepare(`
      UPDATE session_collaboration_grants
      SET child_session_id = ?, started_at = ?
      WHERE credential_hash = ? AND child_session_id IS NULL
    `).run(childSessionId, new Date().toISOString(), grant.credential_hash)
    if (updated.changes !== 1) throw new Error('Credential was already consumed')
  } catch (error) {
    await host.disposeSession(childSessionId).catch(() => {})
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(childSessionId)
    throw error
  }

  grant = { ...grant, child_session_id: childSessionId }
  notifySessionsChanged?.()
  await deliverInitialTask(grant, child)
  return toolResult({
    status: 'started',
    sessionId: childSessionId,
    reused: false,
    name: displayName,
    role,
    title,
    config: {
      model: config.model,
      effort: config.effort,
      permissionMode: config.permissionMode,
      sandboxMode: config.sandboxMode,
      cwd,
      apiProviderId: config.apiProviderId ?? null,
      name: displayName,
      role,
      ...(config.worktree ? { worktree: config.worktree } : {}),
    },
  })
}

function nextSequence(credentialHash: string): number {
  const row = getDb().prepare(`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
    FROM session_collaboration_messages WHERE credential_hash = ?
  `).get(credentialHash) as { next_sequence: number }
  return row.next_sequence
}

export interface SessionSendArgs {
  credential: string
  content: string
  clientMessageId?: string
}

export async function sendSessionMessage(
  callerSessionId: string,
  args: SessionSendArgs,
  host: SessionManager,
) {
  assertEnabled()
  const grant = grantForCredential(args.credential)
  if (!grant) return toolResult({ status: 'error', message: 'Invalid collaboration credential' }, true)
  assertEndpoint(grant, callerSessionId)
  if (!grant.child_session_id) return toolResult({ status: 'error', message: 'The child session has not been started' }, true)
  const recipientSessionId = callerSessionId === grant.parent_session_id
    ? grant.child_session_id
    : grant.parent_session_id
  const content = args.content?.trim()
  if (!content) return toolResult({ status: 'error', message: 'content must not be empty' }, true)
  if (content.length > 100_000) return toolResult({ status: 'error', message: 'content may contain at most 100,000 characters' }, true)

  const insert = getDb().transaction(() => {
    if (args.clientMessageId) {
      const existing = getDb().prepare(`
        SELECT * FROM session_collaboration_messages
        WHERE credential_hash = ? AND sender_session_id = ? AND client_message_id = ?
      `).get(grant.credential_hash, callerSessionId, args.clientMessageId) as MessageRow | undefined
      if (existing) return { row: existing, reused: true }
    }
    const row: MessageRow = {
      id: randomUUID(),
      credential_hash: grant.credential_hash,
      sequence: nextSequence(grant.credential_hash),
      sender_session_id: callerSessionId,
      recipient_session_id: recipientSessionId,
      client_message_id: args.clientMessageId ?? null,
      content,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO session_collaboration_messages
        (id, credential_hash, sequence, sender_session_id, recipient_session_id, client_message_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.credential_hash, row.sequence, row.sender_session_id, row.recipient_session_id, row.client_message_id, row.content, row.created_at)
    return { row, reused: false }
  })()

  if (!insert.reused) {
    // Mailbox traffic is already visible via session_send / session_retrieve tool UI.
    // Do not also inject collab transcript bubbles (that doubled the UI).
    void wakeCollaborationPeer(host, recipientSessionId, args.credential)
  }
  const peer = describePeerForCaller(grant, callerSessionId)
  return toolResult({
    status: 'sent',
    messageId: insert.row.id,
    sequence: insert.row.sequence,
    reused: insert.reused,
    to: peer,
    peerSessionId: recipientSessionId,
  })
}

function readMailbox(callerSessionId: string, grants: AuthorizedGrant[]) {
  return getDb().transaction(() => {
    const perGrantLimit = Math.max(1, Math.floor(MAX_MESSAGES_PER_RETRIEVE / grants.length))
    const messages: Array<{
      credential: string
      messageId: string
      sequence: number
      fromSessionId: string
      content: string
      createdAt: string
      from: { name: string; role: string; title: string; sessionId: string }
    }> = []
    for (const grant of grants) {
      const cursor = getDb().prepare(`
        SELECT last_sequence FROM session_collaboration_cursors
        WHERE credential_hash = ? AND session_id = ?
      `).get(grant.credential_hash, callerSessionId) as { last_sequence: number } | undefined
      const rows = getDb().prepare(`
        SELECT * FROM session_collaboration_messages
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence > ?
        ORDER BY sequence LIMIT ?
      `).all(grant.credential_hash, callerSessionId, cursor?.last_sequence ?? 0, perGrantLimit) as MessageRow[]
      if (rows.length === 0) continue
      const lastSequence = rows[rows.length - 1].sequence
      const now = new Date().toISOString()
      getDb().prepare(`
        INSERT INTO session_collaboration_cursors (credential_hash, session_id, last_sequence)
        VALUES (?, ?, ?)
        ON CONFLICT(credential_hash, session_id) DO UPDATE SET last_sequence = excluded.last_sequence
      `).run(grant.credential_hash, callerSessionId, lastSequence)
      getDb().prepare(`
        UPDATE session_collaboration_messages SET delivered_at = COALESCE(delivered_at, ?)
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence <= ?
      `).run(now, grant.credential_hash, callerSessionId, lastSequence)
      const peer = describePeerForCaller(grant, callerSessionId)
      for (const row of rows) {
        messages.push({
          credential: grant.credential,
          messageId: row.id,
          sequence: row.sequence,
          fromSessionId: row.sender_session_id,
          content: row.content,
          createdAt: row.created_at,
          from: {
            ...peer,
            sessionId: peer.sessionId!,
          },
        })
      }
    }
    return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, MAX_MESSAGES_PER_RETRIEVE)
  })()
}

export interface SessionRetrieveArgs {
  credentials: string[]
}

const EMPTY_MAILBOX_HINT =
  'No peer has replied yet. Do not retrieve again, do not sleep, do not wait in place — end your turn or do unrelated work. '
  + 'A task notification will start a new turn for you as soon as a message arrives.'

/**
 * Non-blocking mailbox read. Advances this endpoint's cursor for any messages
 * currently available. Peers are woken via task notification on send; the agent
 * should call this after a wake (or when it otherwise wants to drain the inbox).
 */
export async function retrieveSessionMessages(
  callerSessionId: string,
  args: SessionRetrieveArgs,
) {
  assertEnabled()
  if (!Array.isArray(args.credentials) || args.credentials.length === 0) {
    return toolResult({ status: 'error', message: 'credentials must not be empty' }, true)
  }
  if (args.credentials.length > 32) {
    return toolResult({ status: 'error', message: 'At most 32 credentials may be retrieved at once' }, true)
  }

  let grants: AuthorizedGrant[]
  try {
    grants = [...new Set(args.credentials)].map((credential) => {
      const grant = grantForCredential(credential)
      if (!grant) throw new Error('Invalid collaboration credential')
      assertEndpoint(grant, callerSessionId)
      return { ...grant, credential }
    })
  } catch (error) {
    return toolResult({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }, true)
  }

  const peers = grants.map((grant) => ({
    credential: grant.credential,
    ...describePeerForCaller(grant, callerSessionId),
  }))

  const messages = readMailbox(callerSessionId, grants)
  if (messages.length > 0) return toolResult({ status: 'messages', messages, peers })
  // Static tool descriptions decay in long contexts; repeat the "stop waiting"
  // rule in the payload the agent reads at the exact moment it wants to re-poll.
  return toolResult({ status: 'empty', messages: [], peers, hint: EMPTY_MAILBOX_HINT })
}
