/**
 * Credential-scoped Agent collaboration grants + mailbox (desktop parity).
 *
 * Ownership lives on the node SessionRuntime path: grants, messages, and
 * cursors are durable in state.sqlite and survive node restart. The rows,
 * authorization, and agent-facing text come from @superone/runtime/collaboration.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import {
  SESSION_AGENT_LAUNCHES_FIELD,
  type SessionAgentLaunchConfig,
  type SessionAgentLaunchProposal,
  type SessionAgentProfile,
  type SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import { normalizeSessionHarnessId } from '@superone/shared/environment'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import type { HarnessId } from '@superone/shared/session-types'
import type { SessionProviderStore } from '@superone/runtime/session'
import {
  CollaborationError,
  CollaborationStore,
  EMPTY_MAILBOX_HINT,
  MAX_MESSAGES_PER_RETRIEVE,
  NESTED_COLLABORATION_UNSUPPORTED,
  assertLaunchCount,
  assertMailboxEndpoint,
  collaborationSessionTitle,
  collaborationSystemPrompt,
  deriveCollaborationName,
  deriveCollaborationRole,
  describeLaunchedPeer,
  handoffTaskContent,
  hashCollaborationCredential,
  linkActivationWakeText,
  mailboxWakeText,
  mergeConfirmedLaunches,
  normalizeLaunchText,
  normalizeMailboxContent,
  parseGrantConfig,
  patchEditableLaunchConfig,
  resolveLaunchMode,
  resolveMailboxRecipient,
  type CollaborationGrantRow as GrantRow,
  type CollaborationSecretCrypto,
} from '@superone/runtime/collaboration'
import type { NodeDatabase } from '../db/database'
import type { ProviderStore } from '../provider/provider-store'
import { listHarnessApiProviders, listHarnessModels } from '../provider/resolve-service'
import type { WorkspaceGitService } from '../workspace/git-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { EventLog } from './event-log'
import type { HarnessManager } from './harness-manager'
import type { SessionRuntime } from './session-runtime'

export type { CollaborationSecretCrypto }

type NodeLaunchConfig = SessionAgentLaunchConfig & { worktreePath?: string }

export interface CollaborationDeps {
  db: NodeDatabase
  events: EventLog
  environmentId: string
  sessions: SessionRuntime
  harnesses: HarnessManager
  providers: ProviderStore
  projects: ProjectRegistry
  workspaceGit: WorkspaceGitService
  secrets: CollaborationSecretCrypto
  /** Session-layer provider profiles (feeds multi-profile listProfiles). */
  sessionProviders?: SessionProviderStore
  experimentalClaudeOpenAiChatEnabled?: () => boolean
}

/**
 * Accept a bare harness id (`claude`) as well as a provider row id
 * (`claude-base`). The bare form used to be listed as its own profile; it no
 * longer is (desktop never listed it, and it duplicated every agent in the
 * @-mention popup), but grants written before this — and any tool call that
 * still passes it — must keep resolving.
 */
function resolveProfile(
  profiles: Map<string, SessionAgentProfile>,
  agentId: string,
): SessionAgentProfile | undefined {
  const direct = profiles.get(agentId)
  if (direct) return direct
  const wire = normalizeSessionHarnessId(agentId)
  return wire ? profiles.get(`${wire}-base`) : undefined
}

/**
 * Same-environment Agent collaboration service.
 * Replaces the flat collaboration_messages mailbox with grant-scoped tables.
 */
export class CollaborationService {
  private readonly store: CollaborationStore

  constructor(private readonly deps: CollaborationDeps) {
    this.store = new CollaborationStore(deps.db, deps.secrets)
  }

  /** Agent profiles from session_providers (+ ready-harness fallback). */
  listProfiles(): SessionAgentProfile[] {
    const { harnesses, providers, sessions, sessionProviders } = this.deps
    const profiles: SessionAgentProfile[] = []
    const seen = new Set<string>()
    const providerOptions = {
      experimentalClaudeOpenAiChatEnabled:
        this.deps.experimentalClaudeOpenAiChatEnabled?.() ?? false,
    }

    const pushProfile = (
      profileId: string,
      harnessId: HarnessId,
      name: string,
      description: string,
      /** Optional session_providers.config — multi-profile defaults. */
      profileConfig?: unknown,
    ) => {
      if (seen.has(profileId)) return
      // Same gate as session.create: never offer an agent this node cannot
      // launch. Desktop applies the identical enabled+ready rule, so a
      // remote @codex mention means the same thing on both sides.
      if (!harnesses.isSessionHarnessRunnable(harnessId)) return
      seen.add(profileId)
      const harnessModels = listHarnessModels(providers, harnessId, null, providerOptions)
      const models = harnessModels.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        ...(m.description ? { description: m.description } : {}),
        ...(m.serviceTiers?.length ? { serviceTiers: m.serviceTiers } : {}),
      }))
      const defaultModel = harnessModels.find((m) => m.isDefault) ?? harnessModels[0]
      const efforts = new Set<string>()
      for (const m of harnessModels) {
        for (const e of m.supportedEffortLevels ?? []) efforts.add(e)
      }
      const cfg =
        profileConfig && typeof profileConfig === 'object' && !Array.isArray(profileConfig)
          ? (profileConfig as Record<string, unknown>)
          : {}
      const cfgModel =
        typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model.trim() : undefined
      const cfgEffort =
        typeof cfg.effort === 'string' && cfg.effort.trim()
          ? cfg.effort.trim()
          : typeof cfg.reasoningEffort === 'string' && cfg.reasoningEffort.trim()
            ? cfg.reasoningEffort.trim()
            : undefined
      // ACP is a protocol, not a brand: the row's config names the concrete
      // agent (grok-build), which is what the user sees and @-mentions.
      const acpAgentId =
        harnessId === 'acp' && typeof cfg.agentId === 'string' && cfg.agentId.trim()
          ? cfg.agentId.trim()
          : null
      const modelDefault = cfgModel ?? defaultModel?.id
      const effortDefault =
        cfgEffort ??
        (efforts.has('high')
          ? 'high'
          : efforts.has('medium')
            ? 'medium'
            : efforts.size > 0
              ? [...efforts][0]
              : undefined)
      profiles.push({
        id: profileId,
        name: harnessId === 'acp' ? acpAgentDisplayName(acpAgentId) : name,
        harnessId,
        ...(acpAgentId ? { acpAgentId } : {}),
        brandKey: resolveHarnessBrandKey(harnessId, acpAgentId),
        description,
        defaultConfig: {
          ...(modelDefault ? { model: modelDefault } : {}),
          ...(effortDefault ? { effort: effortDefault } : {}),
          ...(harnessId === 'codex'
            ? { fastMode: typeof cfg.fastMode === 'boolean' ? cfg.fastMode : false }
            : {}),
        },
        models: models.length > 0 ? models : [{ id: 'default', name: 'Default' }],
        efforts: [...efforts],
        apiProviders: listHarnessApiProviders(providers, harnessId, providerOptions),
      })
    }

    // Prefer CRUD-managed session_providers (base + custom multi-profile).
    if (sessionProviders) {
      for (const p of sessionProviders.list()) {
        pushProfile(
          p.id,
          p.harnessId,
          p.name,
          p.isBase
            ? `${p.harnessId} harness with the built-in configuration`
            : `Custom ${p.harnessId} profile`,
          p.config,
        )
      }
    }

    // Fallback for a node without the session_providers store: ready harnesses,
    // plus any harness that has actually run a session here. Previously this
    // seeded EVERY catalog harness when none were ready, which offered agents
    // the node could not launch; pushProfile's gate now rejects those anyway.
    if (profiles.length === 0) {
      const seedIds = new Set<string>(harnesses.readySessionHarnessIds())
      for (const s of sessions.list()) {
        if (s.harnessId) seedIds.add(s.harnessId)
      }
      for (const id of seedIds) {
        const harnessId = (normalizeSessionHarnessId(id) ?? id) as HarnessId
        pushProfile(harnessId, harnessId, harnessId, `${harnessId} harness`)
      }
    }

    return profiles
  }

  /**
   * Request child launches. When `requireUserConfirm` is true (MCP tool path),
   * emits pendingInteraction kind session_agents_confirm and waits for the
   * desktop remote UI accept/decline/cancel (+ formAnswers).
   * RPC path defaults to auto-approve (already-trusted controller).
   */
  async request(input: {
    parentSessionId: string
    launches: Array<{
      launchId?: string
      mode?: SessionCollabLaunchMode
      agentId?: string
      sessionId?: string
      /** Short confirm-UI description. Optional for spawn when task is present. */
      summary?: string
      task?: string
      name?: string
      role?: string
      config?: NodeLaunchConfig
    }>
    requireUserConfirm?: boolean
    signal?: AbortSignal
  }): Promise<
    | {
        status: 'approved'
        launches: Array<{
          launchId: string
          mode: SessionCollabLaunchMode
          agentId: string
          sessionId?: string
          peerSessionId?: string
          summary: string
          task: string
          name: string
          role: string
          title: string
          config: SessionAgentLaunchConfig
          credential: string
          grantId: string
          reused?: boolean
        }>
      }
    | { status: 'cancelled'; message?: string }
    | { status: 'rejected'; feedback?: unknown }
  > {
    const parent = this.deps.sessions.get(input.parentSessionId)
    if (!parent) throw new CollaborationError('Parent session is not available', 'not_found')
    if (this.store.isSpawnChild(input.parentSessionId)) {
      throw new CollaborationError(NESTED_COLLABORATION_UNSUPPORTED, 'failed_precondition')
    }

    const launches = input.launches
    if (!Array.isArray(launches)) {
      throw new CollaborationError('launches must contain at least one proposed session', 'invalid_argument')
    }
    assertLaunchCount(launches.length)

    const profileList = this.listProfiles()
    const profiles = new Map(profileList.map((p) => [p.id, p]))
    const normalized: SessionAgentLaunchProposal[] = launches.map((launch) => {
      const mode = resolveLaunchMode(launch.mode)
      const launchId = launch.launchId?.trim() || randomUUID()

      if (mode === 'link') {
        const peerSessionId = launch.sessionId?.trim()
        if (!peerSessionId) {
          throw new CollaborationError('Link launches require sessionId of an existing SuperOne session', 'invalid_argument')
        }
        if (peerSessionId === input.parentSessionId) {
          throw new CollaborationError('Cannot link a session to itself', 'invalid_argument')
        }
        const peer = this.deps.sessions.get(peerSessionId)
        if (!peer) throw new CollaborationError(`Unknown sessionId for link: ${peerSessionId}`, 'not_found')
        const peerTitle = peer.title?.trim() || peerSessionId.slice(0, 8)
        const { summary, task, name, role } = normalizeLaunchText('link', launch, peerTitle)
        return {
          launchId,
          mode: 'link',
          agentId: '',
          sessionId: peerSessionId,
          peerTitle,
          peerProjectPath: this.deps.projects.get(peer.projectId)?.path,
          summary,
          task,
          name,
          role,
          config: { name, role, summary },
        }
      }

      // spawn + handoff share this whole branch; they differ only in nesting and
      // in whether the new session gets a mailbox credential.
      const agentId = launch.agentId?.trim()
      if (!agentId) {
        throw new CollaborationError(`${mode} launches require agentId from session_collab_list_agents`, 'invalid_argument')
      }
      const profile = resolveProfile(profiles, agentId)
      if (!profile) throw new CollaborationError(`Unknown agent profile: ${agentId}`, 'invalid_argument')
      const { summary, task, name, role } = normalizeLaunchText(mode, launch)
      // Only allowlisted keys from launch.config may influence the grant.
      // permissionMode/sandboxMode always start at safe defaults for the RPC
      // path; elevation is only possible after requireUserConfirm form merge.
      const raw: NodeLaunchConfig = launch.config && typeof launch.config === 'object' ? launch.config : {}
      const safeFromLaunch: NodeLaunchConfig = {}
      if (typeof raw.model === 'string' && raw.model.trim()) safeFromLaunch.model = raw.model.trim()
      if (typeof raw.effort === 'string' && raw.effort.trim()) safeFromLaunch.effort = raw.effort.trim()
      if (raw.apiProviderId === null) safeFromLaunch.apiProviderId = null
      else if (typeof raw.apiProviderId === 'string' && raw.apiProviderId.trim()) {
        safeFromLaunch.apiProviderId = raw.apiProviderId.trim()
      }
      if (raw.worktree && typeof raw.worktree === 'object') safeFromLaunch.worktree = raw.worktree
      if (typeof raw.worktreePath === 'string' && raw.worktreePath.trim()) {
        safeFromLaunch.worktreePath = raw.worktreePath.trim()
      }
      if (typeof raw.cwd === 'string' && raw.cwd.trim()) safeFromLaunch.cwd = raw.cwd.trim()
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
          ...safeFromLaunch,
          permissionMode: 'default',
          sandboxMode: 'off',
          cwd: safeFromLaunch.cwd ?? (parent.cwd ?? this.deps.projects.get(parent.projectId)?.path),
          name,
          role,
        },
      }
    })

    const launchIds = new Set(normalized.map((l) => l.launchId))
    if (launchIds.size !== normalized.length) {
      throw new CollaborationError('Every confirmed launch must have a unique launchId', 'invalid_argument')
    }

    let confirmed = normalized
    if (input.requireUserConfirm) {
      const outcome = await this.deps.sessions.requestAgentsConfirm({
        sessionId: input.parentSessionId,
        launches: normalized,
        profiles: profileList,
        signal: input.signal,
      })
      if (outcome.action === 'cancel') return { status: 'cancelled' }
      if (outcome.action === 'decline') return { status: 'rejected', feedback: outcome.content?.feedback }
      confirmed = mergeConfirmedLaunches(normalized, outcome.content)
    }

    const results = this.store.transaction(() => confirmed.map((launch) => {
      const mode = resolveLaunchMode(launch.mode)
      const title = collaborationSessionTitle(launch.name, launch.role)
      if (mode === 'link') {
        const peerSessionId = launch.sessionId!
        const existing = this.store.findLinkGrant(input.parentSessionId, peerSessionId)
        const existingCredential = existing ? this.store.credentialOf(existing) : null
        if (existing && existingCredential) {
          return {
            launchId: launch.launchId,
            mode: 'link' as const,
            agentId: existing.agent_id,
            sessionId: peerSessionId,
            peerSessionId,
            summary: launch.summary,
            task: existing.task,
            name: launch.name,
            role: launch.role,
            title,
            config: parseGrantConfig(existing.config_json),
            credential: existingCredential,
            grantId: existing.credential_hash,
            reused: true,
          }
        }
        // Opening is optional: empty task means wake-only (no mailbox opening body).
        const task = launch.task.trim()
        const config = {
          name: launch.name,
          role: launch.role,
          summary: launch.summary,
          peerSessionId,
          peerTitle: launch.peerTitle,
          peerProjectPath: launch.peerProjectPath,
        }
        const { credential, credentialHash } = this.store.createGrant({
          kind: 'link',
          parentSessionId: input.parentSessionId,
          childSessionId: peerSessionId,
          agentId: '',
          task,
          config,
        })
        this.deps.events.append({
          aggregateType: 'session',
          aggregateId: input.parentSessionId,
          eventType: 'collaboration.grant_created',
          payload: { grantId: credentialHash, mode: 'link', peerSessionId, launchId: launch.launchId },
        })
        return {
          launchId: launch.launchId,
          mode: 'link' as const,
          agentId: '',
          sessionId: peerSessionId,
          peerSessionId,
          summary: launch.summary,
          task,
          name: launch.name,
          role: launch.role,
          title,
          config,
          credential,
          grantId: credentialHash,
          reused: false,
        }
      }

      const config = { ...launch.config, name: launch.name, role: launch.role, summary: launch.summary }
      const { credential, credentialHash } = this.store.createGrant({
        kind: mode,
        parentSessionId: input.parentSessionId,
        agentId: launch.agentId,
        task: launch.task,
        config,
      })
      this.deps.events.append({
        aggregateType: 'session',
        aggregateId: input.parentSessionId,
        eventType: 'collaboration.grant_created',
        payload: { grantId: credentialHash, mode, agentId: launch.agentId, launchId: launch.launchId },
      })
      return {
        launchId: launch.launchId,
        mode,
        agentId: launch.agentId,
        summary: launch.summary,
        task: launch.task,
        name: launch.name,
        role: launch.role,
        title,
        config,
        credential,
        grantId: credentialHash,
        reused: false,
      }
    }))

    return { status: 'approved', launches: results }
  }

  async start(input: {
    credential?: string
    grantId?: string
    formAnswers?: Record<string, unknown>
    /** When set (MCP tool path), must match the grant parent. */
    callerSessionId?: string
    /** Optional controller identity to bind on the child session. */
    controllerClientSessionId?: string | null
  }): Promise<{
    status: 'started' | 'linked'
    mode: SessionCollabLaunchMode
    sessionId: string
    peerSessionId?: string
    reused: boolean
    name: string
    role: string
    title: string
    config: SessionAgentLaunchConfig
    credential: string
    grantId: string
  }> {
    let grant = this.resolveGrant(input.credential, input.grantId)
    if (!grant) throw new CollaborationError('Invalid collaboration credential', 'not_found')
    // grantId alone (without the bearer credential) is a hash lookup that can
    // decrypt the stored secret. Require the caller to prove parent ownership.
    const hasBearer = typeof input.credential === 'string' && input.credential.trim().length > 0
    if (!hasBearer) {
      if (!input.callerSessionId || input.callerSessionId !== grant.parent_session_id) {
        throw new CollaborationError('grantId start requires callerSessionId matching the parent session', 'forbidden')
      }
    } else if (input.callerSessionId && grant.parent_session_id !== input.callerSessionId) {
      throw new CollaborationError('Only the parent session may start this credential', 'forbidden')
    }
    const credential = input.credential ?? this.store.credentialOf(grant)
    if (!credential) throw new CollaborationError('Invalid collaboration credential', 'not_found')

    // formAnswers may patch editable launch config (desktop confirm UI parity).
    // Link grants ignore form config patches.
    if (grant.kind !== 'link' && input.formAnswers && typeof input.formAnswers === 'object') {
      grant = this.applyFormAnswers(grant, input.formAnswers)
    }

    if (grant.kind === 'link') {
      if (!grant.child_session_id) {
        throw new CollaborationError('Link grant is missing peer session id', 'failed_precondition')
      }
      const peerSessionId = grant.child_session_id
      if (!this.deps.sessions.get(peerSessionId)) {
        throw new CollaborationError(`Peer session no longer exists: ${peerSessionId}`, 'not_found')
      }
      const alreadyStarted = Boolean(grant.started_at)
      if (!alreadyStarted) this.store.markStarted(grant.credential_hash)
      const opening = grant.task?.trim() ?? ''
      const initiatorTitle = this.initiatorTitleOf(grant)
      if (!alreadyStarted && opening) {
        await this.deliverLinkOpening(grant, credential, initiatorTitle)
      } else {
        void this.wakeLinkPeer(peerSessionId, credential, grant.parent_session_id, initiatorTitle, false)
        if (!alreadyStarted) this.store.markTaskSent(grant.credential_hash)
      }
      const peer = describeLaunchedPeer(grant)
      return {
        status: 'linked',
        mode: 'link',
        sessionId: peerSessionId,
        peerSessionId,
        reused: alreadyStarted,
        name: peer.name,
        role: peer.role,
        title: peer.title,
        config: peer.config,
        credential,
        grantId: grant.credential_hash,
      }
    }

    // spawn + handoff both create a session and deliver the task; a handoff
    // session id lives in config_json, never in child_session_id.
    const isHandoff = grant.kind === 'handoff'
    const existingHandoffSessionId = isHandoff
      ? parseGrantConfig<{ handoffSessionId?: string }>(grant.config_json).handoffSessionId
      : undefined
    if (existingHandoffSessionId) {
      // Unlike a spawn child, a handoff session is not FK-linked to the grant, so
      // deleting it leaves this row behind — do not report a dead session as started.
      if (!this.deps.sessions.get(existingHandoffSessionId)) {
        throw new CollaborationError(`The handoff session no longer exists: ${existingHandoffSessionId}`, 'not_found')
      }
      await this.deliverInitialTask(grant, existingHandoffSessionId)
      const peer = describeLaunchedPeer(grant)
      return {
        status: 'started',
        mode: 'handoff',
        sessionId: existingHandoffSessionId,
        reused: true,
        name: peer.name,
        role: peer.role,
        title: peer.title,
        config: peer.config,
        credential,
        grantId: grant.credential_hash,
      }
    }

    if (grant.child_session_id) {
      const existing = this.deps.sessions.get(grant.child_session_id)
      if (existing) {
        this.deps.sessions.setSystemPromptAppend(
          existing.sessionId,
          collaborationSystemPrompt(credential, grant.parent_session_id),
        )
        await this.deliverInitialTask(grant, existing.sessionId)
      }
      const peer = describeLaunchedPeer(grant)
      return {
        status: 'started',
        mode: 'spawn',
        sessionId: grant.child_session_id,
        reused: true,
        name: peer.name,
        role: peer.role,
        title: peer.title,
        config: peer.config,
        credential,
        grantId: grant.credential_hash,
      }
    }

    const parent = this.deps.sessions.get(grant.parent_session_id)
    if (!parent) throw new CollaborationError('Parent session is not available', 'not_found')

    const config = parseGrantConfig<NodeLaunchConfig>(grant.config_json)
    let cwd = this.resolveCwd(config, parent.projectId, parent.cwd)
    if (config.worktreePath && typeof config.worktreePath === 'string' && config.worktreePath.trim()) {
      cwd = pathResolve(config.worktreePath.trim())
    } else if (config.worktree?.enabled) {
      const wt = this.deps.workspaceGit.activateWorktree(parent.projectId, {
        baseBranch: config.worktree.baseBranch || 'HEAD',
        mode: config.worktree.mode ?? 'branch',
        branchName: config.worktree.branchName,
        carryLocalChanges: config.worktree.carryLocalChanges,
      })
      cwd = wt.path
    }

    const profile = resolveProfile(new Map(this.listProfiles().map((p) => [p.id, p])), grant.agent_id)
    const harnessId = (profile?.harnessId
      ?? normalizeSessionHarnessId(grant.agent_id)
      ?? 'claude') as HarnessId
    const displayName = deriveCollaborationName({ name: config.name })
    const role = deriveCollaborationRole({ role: config.role, task: grant.task })
    const title = collaborationSessionTitle(displayName, role)

    let child
    try {
      child = this.deps.sessions.create({
        projectId: parent.projectId,
        harnessId,
        providerId: grant.agent_id,
        title,
        cwd,
        model: config.model ?? null,
        effort: config.effort ?? null,
        permissionMode: config.permissionMode ?? null,
        sandboxMode: config.sandboxMode ?? null,
        apiProviderId: config.apiProviderId ?? null,
        controllerClientSessionId: input.controllerClientSessionId ?? parent.controllerClientSessionId,
        // Handoff is one-way by construction: never hand the receiver a credential.
        ...(isHandoff
          ? {}
          : { systemPromptAppend: collaborationSystemPrompt(credential, grant.parent_session_id) }),
      })
      this.store.bindStartedSession(grant, child.sessionId, config)
    } catch (err) {
      if (child?.sessionId) {
        try {
          this.deps.sessions.remove(child.sessionId)
        } catch {
          /* best-effort */
        }
      }
      throw err
    }

    grant = isHandoff ? grant : { ...grant, child_session_id: child.sessionId }
    await this.deliverInitialTask(grant, child.sessionId)

    this.deps.events.append({
      aggregateType: 'session',
      aggregateId: grant.parent_session_id,
      eventType: isHandoff ? 'collaboration.handoff_started' : 'collaboration.child_started',
      payload: { grantId: grant.credential_hash, childSessionId: child.sessionId },
    })

    return {
      status: 'started',
      mode: grant.kind,
      sessionId: child.sessionId,
      reused: false,
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
        ...(config.worktreePath ? { worktreePath: config.worktreePath } as never : {}),
      },
      credential,
      grantId: grant.credential_hash,
    }
  }

  send(input: {
    credential: string
    content: string
    clientMessageId?: string
    /** Calling endpoint (parent or child). */
    sessionId: string
  }): {
    status: 'sent'
    messageId: string
    sequence: number
    reused: boolean
    peerSessionId: string
  } {
    const grant = this.store.grantByCredential(input.credential)
    if (!grant) throw new CollaborationError('Invalid collaboration credential', 'not_found')
    const recipientSessionId = resolveMailboxRecipient(grant, input.sessionId)
    const content = normalizeMailboxContent(input.content)
    const insert = this.store.appendMessage({
      credentialHash: grant.credential_hash,
      senderSessionId: input.sessionId,
      recipientSessionId,
      clientMessageId: input.clientMessageId,
      content,
    })

    if (!insert.reused) {
      this.deps.events.append({
        aggregateType: 'session',
        aggregateId: input.sessionId,
        eventType: 'collaboration.message',
        payload: {
          messageId: insert.row.id,
          grantId: grant.credential_hash,
          toSessionId: recipientSessionId,
          sequence: insert.row.sequence,
        },
      })
      // Best-effort peer wake via host-initiated turn (non-blocking).
      void this.wakePeer(recipientSessionId, input.credential)
    }

    return {
      status: 'sent',
      messageId: insert.row.id,
      sequence: insert.row.sequence,
      reused: insert.reused,
      peerSessionId: recipientSessionId,
    }
  }

  retrieve(input: {
    credential?: string
    /** Desktop/MCP tool shape: drain several mailboxes in one call. */
    credentials?: string[]
    sessionId: string
    max?: number
  }): {
    status: 'messages' | 'empty'
    messages: Array<{
      messageId: string
      sequence: number
      fromSessionId: string
      content: string
      createdAt: string
      credential?: string
    }>
    hint?: string
  } {
    const credentials = [
      ...(typeof input.credential === 'string' && input.credential.trim() ? [input.credential.trim()] : []),
      ...(Array.isArray(input.credentials)
        ? input.credentials.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : []),
    ]
    if (credentials.length === 0) throw new CollaborationError('credentials required', 'invalid_argument')

    const max = Math.min(
      MAX_MESSAGES_PER_RETRIEVE,
      Math.max(1, typeof input.max === 'number' && Number.isFinite(input.max) ? Math.floor(input.max) : MAX_MESSAGES_PER_RETRIEVE),
    )
    const credentialByHash = new Map(credentials.map((credential) => {
      const grant = this.store.grantByCredential(credential)
      if (!grant) throw new CollaborationError('Invalid collaboration credential', 'not_found')
      assertMailboxEndpoint(grant, input.sessionId)
      return [grant.credential_hash, credential] as const
    }))
    const messages = this.store.readMailbox(input.sessionId, [...credentialByHash.keys()], max)
      .flatMap(({ credentialHash, rows }) => rows.map((row) => ({
        messageId: row.id,
        sequence: row.sequence,
        fromSessionId: row.sender_session_id,
        content: row.content,
        createdAt: row.created_at,
        ...(credentials.length > 1 ? { credential: credentialByHash.get(credentialHash)! } : {}),
      })))

    if (messages.length === 0) return { status: 'empty', messages: [], hint: EMPTY_MAILBOX_HINT }
    return { status: 'messages', messages }
  }

  /** Reconstruct system-prompt append for spawn children after restart (never link). */
  rehydrateSystemPrompts(): void {
    for (const grant of this.store.startedSpawnGrants()) {
      const credential = this.store.credentialOf(grant)
      if (!credential || !grant.child_session_id) continue
      if (!this.deps.sessions.get(grant.child_session_id)) continue
      this.deps.sessions.setSystemPromptAppend(
        grant.child_session_id,
        collaborationSystemPrompt(credential, grant.parent_session_id),
      )
    }
  }

  // --- internals -----------------------------------------------------------

  private resolveGrant(credential?: string, grantId?: string): GrantRow | null {
    if (credential && credential.trim()) return this.store.grantByCredential(credential.trim())
    if (grantId && grantId.trim()) return this.store.grantByHash(grantId.trim())
    return null
  }

  private initiatorTitleOf(grant: GrantRow): string {
    return this.deps.sessions.get(grant.parent_session_id)?.title?.trim() || grant.parent_session_id.slice(0, 8)
  }

  private async deliverLinkOpening(grant: GrantRow, credential: string, initiatorTitle: string): Promise<void> {
    if (grant.task_sent === 1 || !grant.child_session_id) return
    const content = grant.task.trim()
    if (!content) {
      this.store.markTaskSent(grant.credential_hash)
      return
    }
    this.store.appendLinkOpening(grant, grant.child_session_id, content)
    void this.wakeLinkPeer(grant.child_session_id, credential, grant.parent_session_id, initiatorTitle, true)
  }

  private async wakeLinkPeer(
    sessionId: string,
    credential: string,
    initiatorSessionId: string,
    initiatorTitle: string,
    hasOpening: boolean,
  ): Promise<void> {
    if (!this.deps.sessions.get(sessionId)) return
    try {
      await this.deps.sessions.sendWithoutLease({
        sessionId,
        text: linkActivationWakeText({ credential, initiatorSessionId, initiatorTitle, hasOpening }),
        source: 'task-notification',
        requestId: `collab-link-wake-${hashCollaborationCredential(credential).slice(0, 12)}-${Date.now()}`,
      })
    } catch {
      /* best-effort */
    }
  }

  private resolveCwd(config: NodeLaunchConfig, projectId: string, parentCwd: string | null): string {
    const project = this.deps.projects.get(projectId)
    const fallback = parentCwd || project?.path || process.cwd()
    const cwd = pathResolve(config.cwd || fallback)
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new CollaborationError(`Working directory does not exist: ${cwd}`, 'invalid_argument')
    }
    return cwd
  }

  /** RPC start path: patch a single grant with the confirm form's editable fields. */
  private applyFormAnswers(grant: GrantRow, formAnswers: Record<string, unknown>): GrantRow {
    const packed = formAnswers[SESSION_AGENT_LAUNCHES_FIELD]
    if (typeof packed !== 'string') return grant
    let edited: unknown
    try {
      edited = JSON.parse(packed)
    } catch {
      return grant
    }
    if (!Array.isArray(edited) || edited.length === 0) return grant
    const patch = (edited[0] as { config?: unknown } | null)?.config
    if (!patch || typeof patch !== 'object') return grant
    const next = patchEditableLaunchConfig(parseGrantConfig(grant.config_json), patch)
    this.store.updateConfig(grant.credential_hash, next)
    return { ...grant, config_json: JSON.stringify(next) }
  }

  private async deliverInitialTask(grant: GrantRow, childSessionId: string): Promise<void> {
    if (grant.task_sent === 1) return
    const config = parseGrantConfig(grant.config_json)
    const text = grant.kind === 'handoff'
      ? handoffTaskContent({
        parentSessionId: grant.parent_session_id,
        parentTitle: this.deps.sessions.get(grant.parent_session_id)?.title?.trim() || null,
        task: grant.task,
      })
      : grant.task
    try {
      await this.deps.sessions.sendWithoutLease({
        sessionId: childSessionId,
        text,
        model: config.model,
        effort: config.effort,
        permissionMode: config.permissionMode,
        sandboxMode: config.sandboxMode,
        apiProviderId: config.apiProviderId,
        requestId: `collaboration-task-${grant.credential_hash.slice(0, 16)}`,
      })
    } catch {
      // Turn may fail without a real harness; still mark task enqueued so start
      // remains idempotent for the child session create path.
    }
    this.store.markTaskSent(grant.credential_hash)
  }

  private async wakePeer(sessionId: string, credential: string): Promise<void> {
    if (!this.deps.sessions.get(sessionId)) return
    try {
      // Host-origin task_notification: full credential reaches the model;
      // SessionRuntime redacts it in the durable transcript (desktop parity).
      await this.deps.sessions.sendWithoutLease({
        sessionId,
        text: mailboxWakeText(credential),
        source: 'task-notification',
        requestId: `collab-wake-${hashCollaborationCredential(credential).slice(0, 12)}-${Date.now()}`,
      })
    } catch {
      /* best-effort */
    }
  }
}

/** @deprecated Use CollaborationService. Kept as a type alias for gradual migration. */
export type CollaborationMailbox = CollaborationService
