import {
  collaborationStore as store,
  notifyCollaborationMailboxChanged,
  readCollaborationMailbox,
} from './collaboration-mailbox'
import { randomUUID } from 'crypto'
import { existsSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { resolve, sep } from 'path'
import type {
  EffortLevel,
  PermissionMode,
  SandboxMode,
  SessionAgentLaunchConfig,
  SessionAgentLaunchProposal,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import {
  EDITABLE_PERMISSION_MODES,
  EDITABLE_SANDBOX_MODES,
  EMPTY_MAILBOX_HINT,
  HANDOFF_NOTE,
  NESTED_COLLABORATION_UNSUPPORTED,
  assertLaunchCount,
  assertMailboxEndpoint,
  collaborationSessionTitle,
  collaborationSystemPrompt,
  deriveCollaborationName,
  deriveCollaborationRole,
  describeLaunchedPeer,
  describePeerForCaller as describeGrantPeerForCaller,
  handoffTaskContent,
  linkActivationWakeText,
  mailboxWakeText,
  mergeConfirmedLaunches,
  normalizeLaunchText,
  normalizeMailboxContent,
  parseGrantConfig as parseConfig,
  readOnlyTargetMessage as collaborationTargetReadOnlyMessage,
  resolveLaunchMode,
  resolveMailboxRecipient,
  type CollaborationGrantRow as GrantRow,
  type CollaborationPeer,
} from '@superone/runtime/collaboration'
import { activateWorktree, resolveMainWorktreeDir } from '../git/worktree-ops'
import { getDb } from '../database'
import { createSession as createSessionRecord } from '../db-sessions'
import { addRecentFolder, getRecentFolders } from '../recent-folders'
import log from '../logger'
import { listSessionAgentProfiles } from './agent-profiles'
import type { Session, SessionManager } from './types'
import { openSessionAgentsConfirm } from './session-collaboration-confirm'

/**
 * Agent-profile listing moved to ./agent-profiles when this file passed 1600
 * lines. Re-exported here so existing importers keep resolving it from the
 * collaboration module.
 */
export { listSessionAgentProfiles } from './agent-profiles'

export interface RequestSessionAgentsArgs {
  launches: Array<{
    launchId?: string
    /**
     * `spawn` (default) creates a nested child; `link` connects an existing
     * sessionId; `handoff` creates a top-level sibling that only receives the task.
     */
    mode?: SessionAgentLaunchProposal['mode']
    /** Required for spawn/handoff; ignored for link. */
    agentId?: string
    /** Required for link: existing SuperOne session id. */
    sessionId?: string
    /** Short confirm-UI description. Optional for spawn/handoff when task is present. */
    summary?: string
    /** Spawn/handoff: full task. Link: optional opening for the peer. */
    task?: string
    /** Agent-chosen human label (not harness name). Used in `Name - Role`. */
    name?: string
    /** Temporary role for child title: `Name - Role`. */
    role?: string
    config?: SessionAgentLaunchConfig
  }>
}

export interface SessionCollaborationRunConfig {
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  codexServiceTier?: string | null
}

let notifySessionsChanged: (() => void) | null = null

export function setSessionCollaborationCallbacks(callbacks: { sessionsChanged(): void } | null): void {
  notifySessionsChanged = callbacks?.sessionsChanged ?? null
}

function toolResult(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

function errorResult(error: unknown) {
  return toolResult({ status: 'error', message: error instanceof Error ? error.message : String(error) }, true)
}

function sessionTitle(sessionId: string): string | null {
  const row = getDb().prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string | null } | undefined
  return row?.title ?? null
}

function initiatorTitleOf(grant: GrantRow): string {
  return sessionTitle(grant.parent_session_id)?.trim() || grant.parent_session_id.slice(0, 8)
}

/**
 * `apiProviderId` is a credential id, and an unknown one is NOT an error further
 * down: the provider resolver silently falls back to the global binding, so the
 * child would quietly run on the default provider while the caller believes it
 * picked a third-party one. Reject it here (and again at grant time, which is the
 * choke point the confirm UI's edits also pass through) so a wrong id is a loud
 * failure with the valid ids attached, not a silent downgrade.
 */
function assertKnownApiProviderId(
  config: SessionAgentLaunchConfig | undefined,
  profile: SessionAgentProfile,
): void {
  const apiProviderId = config?.apiProviderId
  if (typeof apiProviderId !== 'string' || !apiProviderId.trim()) return
  if (profile.apiProviders.some((provider) => provider.id === apiProviderId)) return
  const known = profile.apiProviders.map((provider) => provider.id)
  throw new Error(
    `Unknown apiProviderId for agent ${profile.id}: ${apiProviderId}. `
    + 'It must be a credential id from session_collab_list_agents → agents[].apiProviders[].id'
    + (known.length > 0 ? ` (available: ${known.join(', ')})` : ' (this agent has no third-party providers configured)')
    + '. Omit it to follow the user\'s global provider binding.',
  )
}

function normalizeLaunches(args: RequestSessionAgentsArgs, parent: Session): SessionAgentLaunchProposal[] {
  if (!Array.isArray(args.launches)) throw new Error('launches must contain at least one proposed session')
  assertLaunchCount(args.launches.length)
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  return args.launches.map((launch) => {
    const mode = resolveLaunchMode(launch.mode)
    const launchId = launch.launchId?.trim() || randomUUID()

    if (mode === 'link') {
      const peerSessionId = launch.sessionId?.trim()
      if (!peerSessionId) throw new Error('Link launches require sessionId of an existing SuperOne session')
      if (peerSessionId === parent.id) throw new Error('Cannot link a session to itself')
      // sessions store project_id; path lives on projects (post project_path migration).
      const peerRow = getDb().prepare(`
        SELECT s.id, s.title, p.path AS project_path, s.provider, s.provider_id, s.acp_agent_id
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = ?
      `).get(peerSessionId) as {
        id: string
        title: string | null
        project_path: string
        provider: string | null
        provider_id: string | null
        acp_agent_id: string | null
      } | undefined
      if (!peerRow) throw new Error(`Unknown sessionId for link: ${peerSessionId}`)
      const peerTitle = peerRow.title?.trim() || peerSessionId.slice(0, 8)
      const { summary, task, name, role } = normalizeLaunchText('link', launch, peerTitle)
      // Confirm tabs show harness (same as spawn) — resolve from peer session identity.
      const peerHarnessId = (peerRow.provider?.trim()
        || peerRow.provider_id?.replace(/-base$/, '')
        || 'claude').toLowerCase()
      const peerAcpAgentId = peerRow.acp_agent_id?.trim() || undefined
      const peerBrandKey = resolveHarnessBrandKey(peerHarnessId, peerAcpAgentId)
      const matchedProfile = peerRow.provider_id
        ? profiles.get(peerRow.provider_id)
        : [...profiles.values()].find((p) => p.harnessId === peerHarnessId
          && (!peerAcpAgentId || p.acpAgentId === peerAcpAgentId))
      const peerHarnessName = matchedProfile?.name
        || (peerHarnessId === 'acp' && peerAcpAgentId
          ? acpAgentDisplayName(peerAcpAgentId)
          : peerHarnessId.charAt(0).toUpperCase() + peerHarnessId.slice(1))
      return {
        launchId,
        mode: 'link',
        agentId: '',
        sessionId: peerSessionId,
        peerTitle,
        peerProjectPath: peerRow.project_path,
        peerHarnessId,
        ...(peerAcpAgentId ? { peerAcpAgentId } : {}),
        peerHarnessName,
        peerBrandKey,
        summary,
        task,
        name,
        role,
        config: { name, role, summary },
      }
    }

    // spawn + handoff share the whole launch shape; they differ only in whether the
    // new session is nested under the initiator and gets a mailbox credential.
    const agentId = launch.agentId?.trim()
    if (!agentId) throw new Error(`${mode} launches require agentId from session_collab_list_agents`)
    const profile = profiles.get(agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${agentId}`)
    assertKnownApiProviderId(launch.config, profile)
    const { summary, task, name, role } = normalizeLaunchText(mode, launch)
    return {
      launchId,
      mode,
      agentId,
      summary,
      task,
      name,
      role,
      config: {
        ...profile.defaultConfig,
        permissionMode: 'default',
        sandboxMode: 'off',
        cwd: defaultLaunchCwd(parent),
        ...launch.config,
        name,
        role,
      },
    }
  })
}

function describePeerForCaller(grant: GrantRow, callerSessionId: string): CollaborationPeer {
  return describeGrantPeerForCaller(grant, callerSessionId, sessionTitle)
}

function createGrants(parentSessionId: string, launches: SessionAgentLaunchProposal[]) {
  assertLaunchCount(launches.length)
  const launchIds = new Set(launches.map((launch) => launch.launchId))
  if (launchIds.size !== launches.length) throw new Error('Every confirmed launch must have a unique launchId')
  const profiles = new Map(listSessionAgentProfiles().map((profile) => [profile.id, profile]))
  const grants = store()
  return grants.transaction(() => launches.map((launch) => {
    const mode = resolveLaunchMode(launch.mode)
    const { summary, name, role } = launch

    if (mode === 'link') {
      const peerSessionId = launch.sessionId?.trim()
      if (!peerSessionId) throw new Error('Link launches require sessionId')
      // Reuse an existing initiator→peer link grant (idempotent re-approve).
      const existing = grants.findLinkGrant(parentSessionId, peerSessionId)
      const existingCredential = existing ? grants.credentialOf(existing) : null
      if (existing && existingCredential) {
        return {
          launchId: launch.launchId,
          mode: 'link' as const,
          agentId: existing.agent_id,
          sessionId: peerSessionId,
          peerSessionId,
          summary,
          task: existing.task,
          name,
          role,
          title: collaborationSessionTitle(name, role),
          config: parseConfig(existing.config_json),
          credential: existingCredential,
          reused: true,
        }
      }
      const peerExists = getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(peerSessionId)
      if (!peerExists) throw new Error(`Unknown sessionId for link: ${peerSessionId}`)
      // Opening is optional: empty task means wake-only (no mailbox opening body).
      const task = (launch.task ?? '').trim()
      const config = {
        name,
        role,
        summary,
        peerSessionId,
        peerTitle: launch.peerTitle,
        peerProjectPath: launch.peerProjectPath,
      }
      const { credential } = grants.createGrant({
        kind: 'link',
        parentSessionId,
        childSessionId: peerSessionId,
        agentId: '',
        task,
        config,
      })
      return {
        launchId: launch.launchId,
        mode: 'link' as const,
        agentId: '',
        sessionId: peerSessionId,
        peerSessionId,
        summary,
        task,
        name,
        role,
        title: collaborationSessionTitle(name, role),
        config,
        credential,
        reused: false,
      }
    }

    const profile = profiles.get(launch.agentId)
    if (!profile) throw new Error(`Unknown agent profile: ${launch.agentId}`)
    // Also covers the confirm UI's provider edit, which reaches here as renderer input.
    assertKnownApiProviderId(launch.config, profile)
    const config = {
      ...launch.config,
      ...(typeof launch.config.fastMode === 'boolean'
        ? { codexServiceTier: resolveCodexServiceTier(launch.agentId, launch.config, profile) }
        : {}),
      name,
      role,
      summary,
    }
    const { credential } = grants.createGrant({
      kind: mode,
      parentSessionId,
      agentId: launch.agentId,
      task: launch.task,
      config,
    })
    return {
      launchId: launch.launchId,
      mode,
      agentId: launch.agentId,
      summary,
      task: launch.task,
      name,
      role,
      title: collaborationSessionTitle(name, role),
      config,
      credential,
      reused: false,
    }
  }))
}

export async function requestSessionAgents(
  callerSessionId: string,
  args: RequestSessionAgentsArgs,
  host: SessionManager,
  signal?: AbortSignal,
) {
  // Nested spawn collab is not supported: sidebar only renders one parent→children level,
  // and grandchild grants would orphan intermediate sessions in the UI.
  // Link peers may still request (they are not spawn children).
  if (store().isSpawnChild(callerSessionId)) {
    return toolResult({ status: 'error', message: NESTED_COLLABORATION_UNSUPPORTED }, true)
  }
  const parent = host.getSession(callerSessionId)
  if (!parent) return toolResult({ status: 'error', message: 'Parent session is not available' }, true)
  const launches = normalizeLaunches(args, parent)
  let outcome: Awaited<ReturnType<typeof openSessionAgentsConfirm>>
  try {
    outcome = await openSessionAgentsConfirm(parent, { launches, profiles: listSessionAgentProfiles() }, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out|cancelled/i.test(message)) return toolResult({ status: 'cancelled', message })
    throw error
  }
  if (outcome.action === 'cancel') return toolResult({ status: 'cancelled' })
  if (outcome.action === 'decline') {
    return toolResult({ status: 'rejected', feedback: outcome.content?.feedback })
  }
  const confirmed = mergeConfirmedLaunches(launches, outcome.content)
  const credentials = createGrants(callerSessionId, confirmed)
  return toolResult({ status: 'approved', launches: credentials })
}

/** Spawn children only — link peers must never get system-prompt credential injection. */
export function getSessionCollaborationSystemPrompt(sessionId: string): string | undefined {
  const grants = store()
  const grant = grants.spawnGrantForChild(sessionId)
  const credential = grant ? grants.credentialOf(grant) : null
  return grant && credential ? collaborationSystemPrompt(credential, grant.parent_session_id) : undefined
}

/**
 * Human-approved launch settings for a spawned collaboration child, re-applied on
 * every resume because the child is agent-owned.
 *
 * Spawn children only. A handoff sibling is a normal top-level session the user
 * owns after the first turn: the approved permission/sandbox settings are applied
 * once at creation, and whatever the user picks afterwards wins on resume.
 */
export function getSessionCollaborationRunConfig(
  sessionId: string,
): SessionCollaborationRunConfig | null {
  const row = store().spawnGrantForChild(sessionId)
  if (!row) return null

  const config = parseConfig(row.config_json)
  const permissionMode = config.permissionMode && EDITABLE_PERMISSION_MODES.has(config.permissionMode)
    ? config.permissionMode
    : undefined
  const sandboxMode = config.sandboxMode && EDITABLE_SANDBOX_MODES.has(config.sandboxMode)
    ? config.sandboxMode
    : undefined
  const hasFastMode = typeof config.fastMode === 'boolean'
  const codexServiceTier = hasFastMode
    ? resolveCodexServiceTier(row.agent_id, config)
    : undefined
  if (!permissionMode && !sandboxMode && !hasFastMode) return null
  return {
    ...(permissionMode ? { permissionMode } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(hasFastMode ? { codexServiceTier } : {}),
  }
}

function resolveCodexServiceTier(
  agentId: string,
  config: SessionAgentLaunchConfig,
  resolvedProfile?: ReturnType<typeof listSessionAgentProfiles>[number],
): string | null {
  if (!config.fastMode) return null
  if (config.codexServiceTier !== undefined) return config.codexServiceTier
  const profile = resolvedProfile ?? listSessionAgentProfiles().find((item) => item.id === agentId)
  if (profile?.harnessId !== 'codex') return null
  const model = profile.models.find((item) => item.id === config.model)
  return findCodexFastServiceTier(model)?.id ?? null
}

/**
 * Default launch cwd. Prefer parent.cwd when it still lives under the opened
 * project; if the parent is sitting in a SuperOne worktree (or any path outside
 * the project root), fall back to projectPath so attribution does not key off
 * `~/.worktrees/…`.
 */
function defaultLaunchCwd(parent: Session): string {
  const project = resolve(parent.projectPath)
  const cwd = resolve(parent.cwd)
  if (isWithin(project, cwd)) return parent.cwd
  return parent.projectPath
}

function resolveCwd(config: SessionAgentLaunchConfig, parent: Session): string {
  const cwd = resolve(config.cwd || defaultLaunchCwd(parent))
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`)
  return cwd
}

/** Resolve + realpath so symlink /var vs /private/var forms compare equal. */
function canonicalPath(input: string): string {
  const abs = resolve(input)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

function isWithin(root: string, target: string): boolean {
  const normalizedRoot = canonicalPath(root)
  const normalizedTarget = canonicalPath(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + sep)
}

/** SuperOne places collab/agent worktrees under `~/.worktrees/<repo>/…`. */
function isManagedWorktreePath(dir: string): boolean {
  const managedRoot = resolve(homedir(), '.worktrees')
  return isWithin(managedRoot, dir)
}

/**
 * Decide which sidebar project a collab child should join.
 *
 * Product rules:
 * 1. Agents MAY open a genuinely different directory as its own project
 *    (another repo / scratch folder) — that is intentional cross-project work.
 * 2. Different worktrees of the *same* git repo must share one project row.
 *    Never promote `~/.worktrees/<repo>/<epoch>-<hash>` (or any git worktree
 *    leaf) to a sidebar project; file under the main checkout instead.
 *
 * Call with the *requested* cwd, before worktree activation — a freshly cut
 * worktree lives outside every project root but belongs to the repo it was
 * cut from.
 */
async function ensureChildProject(cwd: string, parentProjectPath: string): Promise<string> {
  const cwdCanon = canonicalPath(cwd)
  let mainDir: string | null = null
  try {
    const resolved = canonicalPath(await resolveMainWorktreeDir(cwd))
    // Only treat as a worktree-of-something when git points elsewhere.
    if (resolved !== cwdCanon) mainDir = resolved
  } catch {
    // Not a git repo / unreadable — path-prefix ownership is enough.
  }

  const candidates = mainDir ? [cwdCanon, mainDir] : [cwdCanon]

  let owner: string | null = null
  let ownerDepth = -1
  const consider = (projectPath: string, candidate: string) => {
    if (!isWithin(projectPath, candidate)) return
    const depth = canonicalPath(projectPath).length
    if (depth > ownerDepth) {
      owner = projectPath
      ownerDepth = depth
    }
  }
  for (const candidate of candidates) {
    consider(parentProjectPath, candidate)
    for (const project of getRecentFolders()) {
      if (project.missing) continue
      consider(project.path, candidate)
    }
  }
  if (owner) return owner

  // Cwd is a worktree leaf of a repo the user has not opened yet — open the
  // main checkout as the project, never the worktree directory itself.
  if (mainDir) {
    addRecentFolder(mainDir)
    return mainDir
  }

  // Managed SuperOne worktree path but main-dir lookup failed (stale/removed):
  // do not invent a `tjdllgg-…` project; keep the parent.
  if (isManagedWorktreePath(cwd)) return parentProjectPath

  // Genuinely new directory (other project / scratch). Agents are allowed to
  // spawn work in a separate project this way.
  addRecentFolder(cwd)
  return cwd
}

/** Title (null while untitled) and project of the session that launched `grant`. */
function parentSessionInfo(grant: GrantRow): { title: string | null; projectPath: string | null } {
  const row = getDb().prepare(`
    SELECT s.title, p.path AS project_path
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?
  `).get(grant.parent_session_id) as { title: string | null; project_path: string | null } | undefined
  return { title: row?.title?.trim() || null, projectPath: row?.project_path ?? null }
}

function initialTaskContent(grant: GrantRow): string {
  if (grant.kind !== 'handoff') return grant.task
  return handoffTaskContent({
    parentSessionId: grant.parent_session_id,
    parentTitle: parentSessionInfo(grant).title,
    task: grant.task,
  })
}

/**
 * Deliver the approved launch task and resolve once the child agent has begun
 * replying (assistant message_start). The remainder of the turn continues in
 * the background so session_start is not blocked for the full first turn.
 */
async function deliverInitialTask(grant: GrantRow, child: Session): Promise<void> {
  if (grant.task_sent === 1) return
  const config = parseConfig(grant.config_json)
  const parent = parentSessionInfo(grant)

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
    content: initialTaskContent(grant),
    model: config.model,
    effort: config.effort as EffortLevel | undefined,
    clientMessageId: `collaboration-task-${grant.credential_hash.slice(0, 16)}`,
    source: 'collaboration',
    collaboration: {
      kind: 'initial_task',
      fromSessionId: grant.parent_session_id,
      fromSessionTitle: parent.title ?? undefined,
      fromProjectPath: parent.projectPath ?? undefined,
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

  store().markTaskSent(grant.credential_hash)
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

/**
 * UI withdraws the composer when a worktree checkout is gone. Collab must not
 * resume/inject a turn into that session (it would run against the fallback
 * project checkout).
 */
function isCollaborationTargetReadOnly(sessionId: string, live: Session | null): boolean {
  if (live?.snapshot.worktreeMissing) return true
  if (live?.snapshot.isWorktree) {
    const dir = live.cwd
    if (dir && (!existsSync(dir) || !statSync(dir).isDirectory())) return true
  }
  const row = getDb().prepare('SELECT worktree_path FROM sessions WHERE id = ?')
    .get(sessionId) as { worktree_path: string | null } | undefined
  const stored = row?.worktree_path?.trim()
  if (!stored) return false
  try {
    return !existsSync(stored) || !statSync(stored).isDirectory()
  } catch {
    return true
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
  if (isCollaborationTargetReadOnly(sessionId, session)) {
    log.debug('[session-collaboration] skip wake; worktree removed sid=%s', sessionId)
    return
  }
  // Always wake — injectTaskNotification already queues behind an in-flight turn.
  try {
    await session.injectTaskNotification(mailboxWakeText(credential))
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
  let grant = store().grantByCredential(credential)
  if (!grant) return toolResult({ status: 'error', message: 'Invalid collaboration credential' }, true)
  if (grant.parent_session_id !== callerSessionId) {
    return toolResult({ status: 'error', message: 'Only the parent session may start this credential' }, true)
  }

  // --- link: bind existing peer, turn-inject only (never system prompt) ---
  if (grant.kind === 'link') {
    if (!grant.child_session_id) {
      return toolResult({ status: 'error', message: 'Link grant is missing peer session id' }, true)
    }
    const peerSessionId = grant.child_session_id
    const peerRow = getDb().prepare('SELECT title FROM sessions WHERE id = ?')
      .get(peerSessionId) as { title: string | null } | undefined
    if (!peerRow) {
      return toolResult({ status: 'error', message: `Peer session no longer exists: ${peerSessionId}` }, true)
    }
    const initiatorTitle = initiatorTitleOf(grant)
    const alreadyStarted = Boolean(grant.started_at)
    const livePeer = host.getSession(peerSessionId)
    if (isCollaborationTargetReadOnly(peerSessionId, livePeer)) {
      return toolResult({
        status: 'error',
        message: collaborationTargetReadOnlyMessage(peerSessionId),
      }, true)
    }
    if (!alreadyStarted) store().markStarted(grant.credential_hash)
    const opening = grant.task?.trim() ?? ''
    const hasOpening = opening.length > 0 && !alreadyStarted
    if (hasOpening) {
      // Deliver opening as a mailbox message (not system prompt).
      await deliverLinkOpening(grant, credential, host)
    } else if (!alreadyStarted) {
      // No opening body — still wake the peer with credential instructions.
      void wakeLinkPeer(host, peerSessionId, credential, grant.parent_session_id, initiatorTitle, false)
      store().markTaskSent(grant.credential_hash)
    } else {
      // Idempotent retry: re-wake without duplicating mailbox.
      void wakeLinkPeer(host, peerSessionId, credential, grant.parent_session_id, initiatorTitle, false)
    }
    const peer = describeLaunchedPeer(grant)
    return toolResult({
      status: 'linked',
      mode: 'link',
      sessionId: peerSessionId,
      peerSessionId,
      reused: alreadyStarted,
      name: peer.name,
      role: peer.role,
      title: peer.title,
      config: peer.config,
    })
  }

  // --- spawn + handoff: both create a session and deliver the task. They differ
  // in nesting, in whether a mailbox credential is injected, and in where the new
  // session id is recorded.
  //
  // A handoff session is deliberately *not* written to child_session_id: that column
  // is UNIQUE and marks a session as a collaboration endpoint, which would both nest
  // the sibling in parent→child queries and permanently block it from being linked or
  // spawned against later. The created id lives in config_json instead. ---
  const isHandoff = grant.kind === 'handoff'
  const existingHandoffSessionId = isHandoff
    ? (parseConfig(grant.config_json) as { handoffSessionId?: string }).handoffSessionId
    : undefined
  if (existingHandoffSessionId) {
    // Unlike a spawn child, a handoff session is not FK-linked to the grant, so
    // deleting it leaves this row behind. resolveLiveSession swallows the resume
    // failure; report it instead of throwing out of the tool call.
    const existing = resolveLiveSession(host, existingHandoffSessionId)
    if (!existing) {
      return toolResult({
        status: 'error',
        message: `The handoff session no longer exists: ${existingHandoffSessionId}`,
      }, true)
    }
    if (isCollaborationTargetReadOnly(existingHandoffSessionId, existing)) {
      return toolResult({
        status: 'error',
        message: collaborationTargetReadOnlyMessage(existingHandoffSessionId),
      }, true)
    }
    await deliverInitialTask(grant, existing)
    const peer = describeLaunchedPeer(grant)
    return toolResult({
      status: 'started',
      mode: 'handoff',
      sessionId: existingHandoffSessionId,
      reused: true,
      note: HANDOFF_NOTE,
      name: peer.name,
      role: peer.role,
      title: peer.title,
      config: peer.config,
    })
  }
  if (grant.child_session_id) {
    const liveChild = host.getSession(grant.child_session_id)
    if (isCollaborationTargetReadOnly(grant.child_session_id, liveChild)) {
      return toolResult({
        status: 'error',
        message: collaborationTargetReadOnlyMessage(grant.child_session_id),
      }, true)
    }
    const existing = liveChild
      ?? host.resumeSession(grant.child_session_id, { passive: true })
    if (existing) await deliverInitialTask(grant, existing)
    const peer = describeLaunchedPeer(grant)
    return toolResult({
      status: 'started',
      mode: grant.kind,
      sessionId: grant.child_session_id,
      reused: true,
      ...(isHandoff ? { note: HANDOFF_NOTE } : {}),
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
  const worktreeEnabled = !!config.worktree?.enabled
  // Attribute before worktree activation so the child files under the source
  // project / main checkout, not under ~/.worktrees/<new-wt>.
  let projectPath = await ensureChildProject(cwd, parent.projectPath)
  // Defense in depth: never file a collab child under a managed worktree leaf.
  if (isManagedWorktreePath(projectPath)) projectPath = parent.projectPath
  let gitBranch: string | null = null
  if (worktreeEnabled) {
    const worktree = await activateWorktree(cwd, {
      baseBranch: config.worktree!.baseBranch || 'HEAD',
      mode: config.worktree!.mode,
      branchName: config.worktree!.branchName,
      carryLocalChanges: config.worktree!.carryLocalChanges,
    })
    cwd = worktree.path
    gitBranch = worktree.recordedBranch
  }

  const childSessionId = randomUUID()
  const agentId = grant.agent_id
  const profile = listSessionAgentProfiles().find((item) => item.id === agentId)
  const codexServiceTier = resolveCodexServiceTier(agentId, config)
  const displayName = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({
    role: config.role,
    task: grant.task,
  })
  const title = collaborationSessionTitle(displayName, role)
  // is_worktree / worktree_path: host-cut worktree OR agent attached cwd to an
  // existing worktree of the project (Reviewer reading implementer's tree).
  const isWorktreeSession = worktreeEnabled || resolve(cwd) !== resolve(projectPath)
  const worktreePath = isWorktreeSession ? cwd : undefined
  createSessionRecord(projectPath, childSessionId, title, isWorktreeSession, gitBranch ?? undefined, worktreePath)
  let child: Session
  // createSession always promotes the new session to project-active. Collaboration
  // children must not steal routing from the parent for unscoped main-process ops.
  // Scoped to the joined project, which is not always the parent's.
  const previousActiveId = host.getActiveSession(projectPath)?.id ?? null
  try {
    child = host.createSession({
      id: childSessionId,
      projectPath,
      cwd,
      gitBranch,
      providerId: grant.agent_id,
      model: config.model,
      effort: config.effort as EffortLevel | undefined,
      codexServiceTier,
      apiProviderId: config.apiProviderId,
      permissionMode: config.permissionMode as PermissionMode | undefined,
      sandboxMode: config.sandboxMode as SandboxMode | undefined,
      acpAgentId: profile?.acpAgentId ?? null,
      // Handoff is one-way by construction: never hand the receiver a credential.
      ...(isHandoff
        ? {}
        : { systemPromptAppend: collaborationSystemPrompt(credential, grant.parent_session_id) }),
    })
    if (previousActiveId && previousActiveId !== childSessionId) {
      try {
        host.setActiveSession(projectPath, previousActiveId)
      } catch (err) {
        log.warn(
          '[session-collaboration] failed to restore previous active session sid=%s: %s',
          previousActiveId,
          err instanceof Error ? err.message : String(err),
        )
        // The previous target disappeared while the child was being created. Do
        // not leave the collaboration child as an accidental routing fallback.
        host.clearActiveSession(projectPath)
      }
    } else if (!previousActiveId) {
      host.clearActiveSession(projectPath)
    }
    child.setTitle(title, 'agent')
    // Persist provider + ACP agent immediately so sidebar brand icons work before first save.
    //
    // api_provider_id / selected_model / selected_effort belong here for the same
    // reason: Session.notifyStateChange refuses to persist an empty transcript, so
    // until the first message lands this row is the renderer's ONLY source for them
    // (chat-store restores both from the persisted row, never from the live Session).
    // Leaving them null made the child's model selector resolve against the global
    // provider binding and show the default harness model name instead of the
    // launched third-party one.
    getDb().prepare(`
      UPDATE sessions
      SET provider_id = ?, provider = ?, acp_agent_id = COALESCE(?, acp_agent_id), title = ?,
          api_provider_id = ?, selected_model = ?, selected_effort = ?
      WHERE id = ?
    `).run(
      grant.agent_id,
      profile?.harnessId ?? null,
      profile?.acpAgentId ?? null,
      title,
      config.apiProviderId ?? null,
      config.model ?? null,
      config.effort ?? null,
      childSessionId,
    )
    store().bindStartedSession(grant, childSessionId, config)
  } catch (error) {
    await host.disposeSession(childSessionId).catch(() => {})
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(childSessionId)
    throw error
  }

  grant = isHandoff ? grant : { ...grant, child_session_id: childSessionId }
  notifySessionsChanged?.()
  await deliverInitialTask(grant, child)
  return toolResult({
    status: 'started',
    mode: grant.kind,
    sessionId: childSessionId,
    reused: false,
    ...(isHandoff ? { note: HANDOFF_NOTE } : {}),
    name: displayName,
    role,
    title,
    config: {
      model: config.model,
      effort: config.effort,
      fastMode: config.fastMode,
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

/**
 * Deliver link opening via mailbox + turn wake. Never touches system prompt.
 */
async function deliverLinkOpening(
  grant: GrantRow,
  credential: string,
  host: SessionManager,
): Promise<void> {
  if (grant.task_sent === 1) return
  if (!grant.child_session_id) return
  const content = grant.task.trim()
  if (!content) {
    store().markTaskSent(grant.credential_hash)
    return
  }
  const recipientSessionId = grant.child_session_id
  store().appendLinkOpening(grant, recipientSessionId, content)
  notifyCollaborationMailboxChanged(recipientSessionId)
  void wakeLinkPeer(host, recipientSessionId, credential, grant.parent_session_id, initiatorTitleOf(grant), true)
}

async function wakeLinkPeer(
  host: SessionManager,
  sessionId: string,
  credential: string,
  initiatorSessionId: string,
  initiatorTitle: string,
  hasOpening: boolean,
): Promise<void> {
  const session = resolveLiveSession(host, sessionId)
  if (!session) {
    log.debug('[session-collaboration] link peer not available for wake sid=%s', sessionId)
    return
  }
  if (isCollaborationTargetReadOnly(sessionId, session)) {
    log.debug('[session-collaboration] skip link wake; worktree removed sid=%s', sessionId)
    return
  }
  try {
    await session.injectTaskNotification(
      linkActivationWakeText({ credential, initiatorSessionId, initiatorTitle, hasOpening }),
    )
  } catch (error) {
    log.warn(
      '[session-collaboration] link wake failed sid=%s: %s',
      sessionId,
      error instanceof Error ? error.message : String(error),
    )
  }
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
  const grants = store()
  const grant = grants.grantByCredential(args.credential)
  if (!grant) return toolResult({ status: 'error', message: 'Invalid collaboration credential' }, true)
  let recipientSessionId: string
  let content: string
  try {
    recipientSessionId = resolveMailboxRecipient(grant, callerSessionId)
    content = normalizeMailboxContent(args.content)
  } catch (error) {
    return errorResult(error)
  }

  const liveRecipient = host.getSession(recipientSessionId)
  if (isCollaborationTargetReadOnly(recipientSessionId, liveRecipient)) {
    return toolResult({
      status: 'error',
      message: collaborationTargetReadOnlyMessage(recipientSessionId),
    }, true)
  }

  const insert = grants.appendMessage({
    credentialHash: grant.credential_hash,
    senderSessionId: callerSessionId,
    recipientSessionId,
    clientMessageId: args.clientMessageId,
    content,
  })
  if (!insert.reused) {
    notifyCollaborationMailboxChanged(recipientSessionId)
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

export interface SessionRetrieveArgs {
  credentials: string[]
}

/**
 * Non-blocking mailbox read. Advances this endpoint's cursor for any messages
 * currently available. Peers are woken via task notification on send; the agent
 * should call this after a wake (or when it otherwise wants to drain the inbox).
 */
export async function retrieveSessionMessages(
  callerSessionId: string,
  args: SessionRetrieveArgs,
) {
  if (!Array.isArray(args.credentials) || args.credentials.length === 0) {
    return toolResult({ status: 'error', message: 'credentials must not be empty' }, true)
  }
  if (args.credentials.length > 32) {
    return toolResult({ status: 'error', message: 'At most 32 credentials may be retrieved at once' }, true)
  }

  const grantStore = store()
  let grants: Array<GrantRow & { credential: string }>
  try {
    grants = [...new Set(args.credentials)].map((credential) => {
      const grant = grantStore.grantByCredential(credential)
      if (!grant) throw new Error('Invalid collaboration credential')
      assertMailboxEndpoint(grant, callerSessionId)
      return { ...grant, credential }
    })
  } catch (error) {
    return errorResult(error)
  }

  const peers = grants.map((grant) => ({
    credential: grant.credential,
    ...describePeerForCaller(grant, callerSessionId),
  }))

  const messages = readCollaborationMailbox(callerSessionId, grants.map((grant) => ({
    credentialHash: grant.credential_hash,
    credential: grant.credential,
    peer: describePeerForCaller(grant, callerSessionId),
  })))
  if (messages.length > 0) {
    notifyCollaborationMailboxChanged(callerSessionId)
    return toolResult({ status: 'messages', messages, peers })
  }
  return toolResult({ status: 'empty', messages: [], peers, hint: EMPTY_MAILBOX_HINT })
}
