/**
 * Credential-scoped Agent collaboration grants + mailbox (desktop parity).
 *
 * Ownership lives on the node SessionRuntime path: grants, messages, and
 * cursors are durable in state.sqlite and survive node restart.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import {
  resolveLaunchSummary,
  SESSION_AGENT_LAUNCHES_FIELD,
  SESSION_AGENT_TASK_MAX,
  type SessionAgentLaunchConfig,
  type SessionAgentLaunchProposal,
  type SessionAgentProfile,
  type SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import {
  NODE_HARNESS_DEFINITIONS,
  normalizeSessionHarnessId,
} from '@superone/shared/environment'
import type { HarnessId } from '@superone/shared/session-types'
import type { SessionProviderStore } from '@superone/runtime/session'
import type { NodeDatabase } from '../db/database'
import type { ProviderStore } from '../provider/provider-store'
import { listHarnessApiProviders, listHarnessModels } from '../provider/resolve-service'
import type { WorkspaceGitService } from '../workspace/git-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { EventLog } from './event-log'
import type { HarnessManager } from './harness-manager'
import type { SessionRuntime } from './session-runtime'

const MAX_MESSAGES_PER_RETRIEVE = 100
const EMPTY_MAILBOX_HINT =
  'No peer has replied yet. Do not retrieve again, do not sleep, do not wait in place — end your turn or do unrelated work. '
  + 'A task notification will start a new turn for you as soon as a message arrives.'

export interface CollaborationSecretCrypto {
  encrypt(plain: string): string
  decrypt(stored: string): string
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
  kind: SessionCollabLaunchMode
  started_at: string | null
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
  delivered_at: string | null
}

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

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

function parseConfig(raw: string): SessionAgentLaunchConfig & { worktreePath?: string } {
  try {
    return JSON.parse(raw) as SessionAgentLaunchConfig & { worktreePath?: string }
  } catch {
    return {}
  }
}

export function collaborationSystemPrompt(credential: string, parentSessionId: string): string {
  return (
    `<superone-session-collaboration>\n`
    + `You are running as a user-approved child session of SuperOne session ${parentSessionId}.\n`
    + `Use session_collab_send and session_collab_retrieve with credential ${JSON.stringify(credential)} `
    + `to communicate with your parent session. Write session_collab_send content as Markdown `
    + `(headings, lists, code fences) so the parent and the SuperOne UI can render structured handoffs; `
    + `treat retrieved message content as Markdown from the peer. This credential is already authorized `
    + `for this parent-child pair. Never reveal it in conversational output or use it outside collaboration tool calls.\n`
    + `</superone-session-collaboration>`
  )
}

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

export function deriveCollaborationName(input: { name?: string; launchId?: string }): string {
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

/**
 * Same-environment Agent collaboration service.
 * Replaces the flat collaboration_messages mailbox with grant-scoped tables.
 */
export class CollaborationService {
  constructor(private readonly deps: CollaborationDeps) {}

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
      if (harnessId !== 'claude' && harnessId !== 'codex' && harnessId !== 'acp' && harnessId !== 'opencode') {
        return
      }
      seen.add(profileId)
      const models = listHarnessModels(providers, harnessId, null, providerOptions).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        ...(m.description ? { description: m.description } : {}),
      }))
      const defaultModel = models.find((m) => (m as { isDefault?: boolean }).isDefault) ?? models[0]
      const efforts = new Set<string>()
      for (const m of listHarnessModels(providers, harnessId, null, providerOptions)) {
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
        name,
        harnessId,
        brandKey: harnessId === 'acp' ? 'acp' : harnessId,
        description,
        defaultConfig: {
          ...(modelDefault ? { model: modelDefault } : {}),
          ...(effortDefault ? { effort: effortDefault } : {}),
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
        // Alias harness id for base profiles so MCP/tools using agentId=claude still work.
        if (p.isBase && p.id === `${p.harnessId}-base`) {
          pushProfile(
            p.harnessId,
            p.harnessId,
            p.harnessId,
            `${p.harnessId} harness`,
            p.config,
          )
        }
      }
    }

    // Fallback: ready harness ids + session seeds when store empty / missing.
    if (profiles.length === 0) {
      const ready = new Set(harnesses.readySessionHarnessIds())
      const seedIds = new Set<string>(
        ready.size > 0
          ? [...ready]
          : NODE_HARNESS_DEFINITIONS.map((d) => d.sessionHarnessId),
      )
      for (const s of sessions.list()) {
        if (s.harnessId) seedIds.add(s.harnessId)
        if (s.providerId) seedIds.add(s.providerId)
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
      config?: SessionAgentLaunchConfig & { worktreePath?: string }
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
    if (!parent) {
      throw Object.assign(new Error('Parent session is not available'), { code: 'not_found' })
    }
    const nested = this.deps.db
      .prepare(
        `SELECT 1 FROM session_collaboration_grants
         WHERE child_session_id = ? AND COALESCE(kind, 'spawn') = 'spawn' LIMIT 1`,
      )
      .get(input.parentSessionId)
    if (nested) {
      throw Object.assign(
        new Error(
          'Nested collaboration is not supported. Only top-level (non-collaboration-child) sessions may request agents.',
        ),
        { code: 'failed_precondition' },
      )
    }

    const launches = input.launches
    if (!Array.isArray(launches) || launches.length === 0) {
      throw Object.assign(new Error('launches must contain at least one proposed session'), {
        code: 'invalid_argument',
      })
    }
    if (launches.length > 16) {
      throw Object.assign(new Error('A single request may contain at most 16 launches'), {
        code: 'invalid_argument',
      })
    }

    const profileList = this.listProfiles()
    const profiles = new Map(profileList.map((p) => [p.id, p]))
    const normalized: SessionAgentLaunchProposal[] = launches.map((launch) => {
      const mode: SessionCollabLaunchMode = launch.mode === 'link' ? 'link' : 'spawn'
      const launchId = launch.launchId?.trim() || randomUUID()

      if (mode === 'link') {
        const peerSessionId = launch.sessionId?.trim()
        if (!peerSessionId) {
          throw Object.assign(
            new Error('Link launches require sessionId of an existing SuperOne session'),
            { code: 'invalid_argument' },
          )
        }
        if (peerSessionId === input.parentSessionId) {
          throw Object.assign(new Error('Cannot link a session to itself'), {
            code: 'invalid_argument',
          })
        }
        const peer = this.deps.sessions.get(peerSessionId)
        if (!peer) {
          throw Object.assign(new Error(`Unknown sessionId for link: ${peerSessionId}`), {
            code: 'not_found',
          })
        }
        const summary = (launch.summary?.trim()
          || resolveLaunchSummary(launch.task ?? '', launch.summary))
        if (!summary) {
          throw Object.assign(new Error('Every launch must include a non-empty summary'), {
            code: 'invalid_argument',
          })
        }
        const task = (launch.task ?? '').trim()
        if (task.length > SESSION_AGENT_TASK_MAX) {
          throw Object.assign(
            new Error(`A launch task may contain at most ${SESSION_AGENT_TASK_MAX.toLocaleString()} characters`),
            { code: 'invalid_argument' },
          )
        }
        const peerTitle = peer.title?.trim() || peerSessionId.slice(0, 8)
        const name = launch.name?.trim() || peerTitle
        const role = launch.role?.trim() || 'Peer'
        const projectPath = this.deps.projects.get(peer.projectId)?.path
        return {
          launchId,
          mode: 'link',
          agentId: '',
          sessionId: peerSessionId,
          peerTitle,
          peerProjectPath: projectPath,
          summary,
          task,
          name,
          role,
          config: { name, role, summary },
        }
      }

      const agentId = launch.agentId?.trim()
      if (!agentId) {
        throw Object.assign(
          new Error('Spawn launches require agentId from session_collab_list_agents'),
          { code: 'invalid_argument' },
        )
      }
      const profile = profiles.get(agentId)
      if (!profile) {
        throw Object.assign(new Error(`Unknown agent profile: ${agentId}`), {
          code: 'invalid_argument',
        })
      }
      const task = launch.task?.trim()
      if (!task) {
        throw Object.assign(new Error('Every spawn launch must include a non-empty task'), {
          code: 'invalid_argument',
        })
      }
      if (task.length > SESSION_AGENT_TASK_MAX) {
        throw Object.assign(
          new Error(`A launch task may contain at most ${SESSION_AGENT_TASK_MAX.toLocaleString()} characters`),
          { code: 'invalid_argument' },
        )
      }
      const summary = resolveLaunchSummary(task, launch.summary)
      if (!summary) {
        throw Object.assign(new Error('Every launch must include a non-empty summary'), {
          code: 'invalid_argument',
        })
      }
      const name = launch.name?.trim()
      if (!name) {
        throw Object.assign(new Error('Every spawn launch must include a non-empty name'), {
          code: 'invalid_argument',
        })
      }
      const role = launch.role?.trim()
      if (!role) {
        throw Object.assign(new Error('Every spawn launch must include a non-empty role'), {
          code: 'invalid_argument',
        })
      }
      // Only allowlisted keys from launch.config may influence the grant.
      // permissionMode/sandboxMode always start at safe defaults for the RPC
      // path; elevation is only possible after requireUserConfirm form merge.
      const raw = launch.config && typeof launch.config === 'object' ? launch.config : {}
      const safeFromLaunch: Record<string, unknown> = {}
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
        mode: 'spawn',
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
          cwd:
            typeof safeFromLaunch.cwd === 'string'
              ? safeFromLaunch.cwd
              : (parent.cwd ?? this.deps.projects.get(parent.projectId)?.path),
          name,
          role,
        },
      }
    })

    const launchIds = new Set(normalized.map((l) => l.launchId))
    if (launchIds.size !== normalized.length) {
      throw Object.assign(new Error('Every confirmed launch must have a unique launchId'), {
        code: 'invalid_argument',
      })
    }

    let confirmed = normalized
    if (input.requireUserConfirm) {
      const outcome = await this.deps.sessions.requestAgentsConfirm({
        sessionId: input.parentSessionId,
        launches: normalized,
        profiles: profileList,
        signal: input.signal,
      })
      if (outcome.action === 'cancel') {
        return { status: 'cancelled' }
      }
      if (outcome.action === 'decline') {
        return { status: 'rejected', feedback: outcome.content?.feedback }
      }
      confirmed = this.mergeConfirmedLaunches(normalized, outcome.content)
    }

    const insertSpawn = this.deps.db.prepare(`
      INSERT INTO session_collaboration_grants
        (credential_hash, credential_secret, credential_hint, parent_session_id, agent_id, task, config_json, created_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'spawn')
    `)
    const insertLink = this.deps.db.prepare(`
      INSERT INTO session_collaboration_grants
        (credential_hash, credential_secret, credential_hint, parent_session_id, child_session_id, agent_id, task, config_json, created_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'link')
    `)

    const results = this.deps.db.transaction(() =>
      confirmed.map((launch) => {
        const mode = launch.mode === 'link' ? 'link' : 'spawn'
        if (mode === 'link') {
          const peerSessionId = launch.sessionId!
          const existing = this.deps.db
            .prepare(
              `SELECT credential_hash, credential_secret, agent_id, task, config_json
               FROM session_collaboration_grants
               WHERE parent_session_id = ? AND child_session_id = ? AND kind = 'link'`,
            )
            .get(input.parentSessionId, peerSessionId) as {
            credential_hash: string
            credential_secret: string | null
            agent_id: string
            task: string
            config_json: string
          } | undefined
          if (existing?.credential_secret) {
            const credential = this.deps.secrets.decrypt(existing.credential_secret)
            if (credential) {
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
                title: collaborationSessionTitle(launch.name, launch.role),
                config: parseConfig(existing.config_json),
                credential,
                grantId: existing.credential_hash,
                reused: true,
              }
            }
          }
          const credential = `s1sc_${randomBytes(32).toString('base64url')}`
          const credentialHash = hashCredential(credential)
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
          try {
            insertLink.run(
              credentialHash,
              this.deps.secrets.encrypt(credential),
              credential.slice(-8),
              input.parentSessionId,
              peerSessionId,
              '',
              task,
              JSON.stringify(config),
              new Date().toISOString(),
            )
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            if (/UNIQUE|unique/i.test(message)) {
              throw Object.assign(
                new Error(
                  `Session ${peerSessionId} is already bound as a collaboration endpoint `
                  + '(spawn child or link peer). A session cannot be the non-initiator endpoint of two grants.',
                ),
                { code: 'failed_precondition' },
              )
            }
            throw err
          }
          this.deps.events.append({
            aggregateType: 'session',
            aggregateId: input.parentSessionId,
            eventType: 'collaboration.grant_created',
            payload: {
              grantId: credentialHash,
              mode: 'link',
              peerSessionId,
              launchId: launch.launchId,
            },
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
            title: collaborationSessionTitle(launch.name, launch.role),
            config,
            credential,
            grantId: credentialHash,
            reused: false,
          }
        }

        const credential = `s1sc_${randomBytes(32).toString('base64url')}`
        const credentialHash = hashCredential(credential)
        const config = {
          ...launch.config,
          name: launch.name,
          role: launch.role,
          summary: launch.summary,
        }
        insertSpawn.run(
          credentialHash,
          this.deps.secrets.encrypt(credential),
          credential.slice(-8),
          input.parentSessionId,
          launch.agentId,
          launch.task,
          JSON.stringify(config),
          new Date().toISOString(),
        )
        this.deps.events.append({
          aggregateType: 'session',
          aggregateId: input.parentSessionId,
          eventType: 'collaboration.grant_created',
          payload: {
            grantId: credentialHash,
            mode: 'spawn',
            agentId: launch.agentId,
            launchId: launch.launchId,
          },
        })
        return {
          launchId: launch.launchId,
          mode: 'spawn' as const,
          agentId: launch.agentId,
          summary: launch.summary,
          task: launch.task,
          name: launch.name,
          role: launch.role,
          title: collaborationSessionTitle(launch.name, launch.role),
          config,
          credential,
          grantId: credentialHash,
          reused: false,
        }
      }),
    )()

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
    if (!grant) {
      throw Object.assign(new Error('Invalid collaboration credential'), { code: 'not_found' })
    }
    // grantId alone (without the bearer credential) is a hash lookup that can
    // decrypt the stored secret. Require the caller to prove parent ownership.
    const hasBearer = typeof input.credential === 'string' && input.credential.trim().length > 0
    if (!hasBearer) {
      if (!input.callerSessionId || input.callerSessionId !== grant.parent_session_id) {
        throw Object.assign(
          new Error('grantId start requires callerSessionId matching the parent session'),
          { code: 'forbidden' },
        )
      }
    } else if (input.callerSessionId && grant.parent_session_id !== input.callerSessionId) {
      throw Object.assign(new Error('Only the parent session may start this credential'), {
        code: 'forbidden',
      })
    }
    const credential =
      input.credential
      ?? (grant.credential_secret ? this.deps.secrets.decrypt(grant.credential_secret) : '')
    if (!credential) {
      throw Object.assign(new Error('Invalid collaboration credential'), { code: 'not_found' })
    }

    // formAnswers may patch editable launch config (desktop confirm UI parity).
    // Link grants ignore form config patches.
    if (grant.kind !== 'link' && input.formAnswers && typeof input.formAnswers === 'object') {
      grant = this.applyFormAnswers(grant, input.formAnswers)
    }

    if (grant.kind === 'link') {
      if (!grant.child_session_id) {
        throw Object.assign(new Error('Link grant is missing peer session id'), {
          code: 'failed_precondition',
        })
      }
      const peerSessionId = grant.child_session_id
      if (!this.deps.sessions.get(peerSessionId)) {
        throw Object.assign(new Error(`Peer session no longer exists: ${peerSessionId}`), {
          code: 'not_found',
        })
      }
      const alreadyStarted = Boolean(grant.started_at)
      if (!alreadyStarted) {
        this.deps.db
          .prepare(
            `UPDATE session_collaboration_grants SET started_at = ?
             WHERE credential_hash = ? AND started_at IS NULL`,
          )
          .run(new Date().toISOString(), grant.credential_hash)
      }
      const opening = grant.task?.trim() ?? ''
      const initiator = this.deps.sessions.get(grant.parent_session_id)
      const initiatorTitle = initiator?.title?.trim() || grant.parent_session_id.slice(0, 8)
      if (!alreadyStarted && opening) {
        await this.deliverLinkOpening(grant, credential, initiatorTitle)
      } else {
        void this.wakeLinkPeer(peerSessionId, credential, grant.parent_session_id, initiatorTitle, false)
        if (!alreadyStarted) {
          this.deps.db
            .prepare(`UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?`)
            .run(grant.credential_hash)
        }
      }
      const peer = this.describePeer(grant)
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

    if (grant.child_session_id) {
      const existing = this.deps.sessions.get(grant.child_session_id)
      if (existing) {
        this.deps.sessions.setSystemPromptAppend(
          existing.sessionId,
          collaborationSystemPrompt(credential, grant.parent_session_id),
        )
        await this.deliverInitialTask(grant, existing.sessionId)
      }
      const peer = this.describePeer(grant)
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
    if (!parent) {
      throw Object.assign(new Error('Parent session is not available'), { code: 'not_found' })
    }

    const config = parseConfig(grant.config_json)
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

    const profile = this.listProfiles().find((p) => p.id === grant!.agent_id)
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
        systemPromptAppend: collaborationSystemPrompt(credential, grant.parent_session_id),
      })
      const updated = this.deps.db
        .prepare(
          `UPDATE session_collaboration_grants
           SET child_session_id = ?, started_at = ?
           WHERE credential_hash = ? AND child_session_id IS NULL`,
        )
        .run(child.sessionId, new Date().toISOString(), grant.credential_hash)
      if (updated.changes !== 1) {
        throw Object.assign(new Error('Credential was already consumed'), {
          code: 'failed_precondition',
        })
      }
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

    grant = { ...grant, child_session_id: child.sessionId }
    await this.deliverInitialTask(grant, child.sessionId)

    this.deps.events.append({
      aggregateType: 'session',
      aggregateId: grant.parent_session_id,
      eventType: 'collaboration.child_started',
      payload: {
        grantId: grant.credential_hash,
        childSessionId: child.sessionId,
      },
    })

    return {
      status: 'started',
      mode: 'spawn',
      sessionId: child.sessionId,
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
    const grant = this.grantForCredential(input.credential)
    if (!grant) {
      throw Object.assign(new Error('Invalid collaboration credential'), { code: 'not_found' })
    }
    this.assertEndpoint(grant, input.sessionId)
    if (!grant.child_session_id) {
      throw Object.assign(
        new Error(
          grant.kind === 'link'
            ? 'The linked peer session is missing'
            : 'The child session has not been started',
        ),
        { code: 'failed_precondition' },
      )
    }
    if (grant.kind === 'link' && !grant.started_at) {
      throw Object.assign(new Error('The collaboration link has not been started'), {
        code: 'failed_precondition',
      })
    }
    const recipientSessionId =
      input.sessionId === grant.parent_session_id
        ? grant.child_session_id
        : grant.parent_session_id
    const content = input.content?.trim()
    if (!content) {
      throw Object.assign(new Error('content must not be empty'), { code: 'invalid_argument' })
    }
    if (content.length > 100_000) {
      throw Object.assign(new Error('content may contain at most 100,000 characters'), {
        code: 'invalid_argument',
      })
    }

    const insert = this.deps.db.transaction(() => {
      if (input.clientMessageId) {
        const existing = this.deps.db
          .prepare(
            `SELECT * FROM session_collaboration_messages
             WHERE credential_hash = ? AND sender_session_id = ? AND client_message_id = ?`,
          )
          .get(grant.credential_hash, input.sessionId, input.clientMessageId) as MessageRow | undefined
        if (existing) return { row: existing, reused: true as const }
      }
      const sequence = this.nextSequence(grant.credential_hash)
      const row: MessageRow = {
        id: randomUUID(),
        credential_hash: grant.credential_hash,
        sequence,
        sender_session_id: input.sessionId,
        recipient_session_id: recipientSessionId,
        client_message_id: input.clientMessageId ?? null,
        content,
        created_at: new Date().toISOString(),
        delivered_at: null,
      }
      this.deps.db
        .prepare(
          `INSERT INTO session_collaboration_messages
            (id, credential_hash, sequence, sender_session_id, recipient_session_id, client_message_id, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.credential_hash,
          row.sequence,
          row.sender_session_id,
          row.recipient_session_id,
          row.client_message_id,
          row.content,
          row.created_at,
        )
      return { row, reused: false as const }
    })()

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
      ...(typeof input.credential === 'string' && input.credential.trim()
        ? [input.credential.trim()]
        : []),
      ...(Array.isArray(input.credentials)
        ? input.credentials.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : []),
    ]
    if (credentials.length === 0) {
      throw Object.assign(new Error('credentials required'), { code: 'invalid_argument' })
    }

    const max = Math.min(
      MAX_MESSAGES_PER_RETRIEVE,
      Math.max(1, typeof input.max === 'number' && Number.isFinite(input.max) ? Math.floor(input.max) : MAX_MESSAGES_PER_RETRIEVE),
    )

    const all: Array<{
      messageId: string
      sequence: number
      fromSessionId: string
      content: string
      createdAt: string
      credential?: string
    }> = []

    for (const credential of credentials) {
      const grant = this.grantForCredential(credential)
      if (!grant) {
        throw Object.assign(new Error('Invalid collaboration credential'), { code: 'not_found' })
      }
      this.assertEndpoint(grant, input.sessionId)

      const messages = this.deps.db.transaction(() => {
        const cursor = this.deps.db
          .prepare(
            `SELECT last_sequence FROM session_collaboration_cursors
             WHERE credential_hash = ? AND session_id = ?`,
          )
          .get(grant.credential_hash, input.sessionId) as { last_sequence: number } | undefined
        const rows = this.deps.db
          .prepare(
            `SELECT * FROM session_collaboration_messages
             WHERE credential_hash = ? AND recipient_session_id = ? AND sequence > ?
             ORDER BY sequence LIMIT ?`,
          )
          .all(
            grant.credential_hash,
            input.sessionId,
            cursor?.last_sequence ?? 0,
            max,
          ) as MessageRow[]
        if (rows.length === 0) return [] as MessageRow[]
        const lastSequence = rows[rows.length - 1].sequence
        const now = new Date().toISOString()
        this.deps.db
          .prepare(
            `INSERT INTO session_collaboration_cursors (credential_hash, session_id, last_sequence)
             VALUES (?, ?, ?)
             ON CONFLICT(credential_hash, session_id) DO UPDATE SET last_sequence = excluded.last_sequence`,
          )
          .run(grant.credential_hash, input.sessionId, lastSequence)
        this.deps.db
          .prepare(
            `UPDATE session_collaboration_messages SET delivered_at = COALESCE(delivered_at, ?)
             WHERE credential_hash = ? AND recipient_session_id = ? AND sequence <= ?`,
          )
          .run(now, grant.credential_hash, input.sessionId, lastSequence)
        return rows
      })()

      for (const row of messages) {
        all.push({
          messageId: row.id,
          sequence: row.sequence,
          fromSessionId: row.sender_session_id,
          content: row.content,
          createdAt: row.created_at,
          ...(credentials.length > 1 ? { credential } : {}),
        })
      }
    }

    if (all.length === 0) {
      return { status: 'empty', messages: [], hint: EMPTY_MAILBOX_HINT }
    }
    return { status: 'messages', messages: all }
  }

  /** Reconstruct system-prompt append for spawn children after restart (never link). */
  rehydrateSystemPrompts(): void {
    const rows = this.deps.db
      .prepare(
        `SELECT credential_secret, parent_session_id, child_session_id
         FROM session_collaboration_grants
         WHERE child_session_id IS NOT NULL
           AND credential_secret IS NOT NULL
           AND COALESCE(kind, 'spawn') = 'spawn'`,
      )
      .all() as Array<{
      credential_secret: string
      parent_session_id: string
      child_session_id: string
    }>
    for (const row of rows) {
      const credential = this.deps.secrets.decrypt(row.credential_secret)
      if (!credential) continue
      if (!this.deps.sessions.get(row.child_session_id)) continue
      this.deps.sessions.setSystemPromptAppend(
        row.child_session_id,
        collaborationSystemPrompt(credential, row.parent_session_id),
      )
    }
  }

  // --- internals -----------------------------------------------------------

  private resolveGrant(credential?: string, grantId?: string): GrantRow | null {
    if (credential && credential.trim()) return this.grantForCredential(credential.trim())
    if (grantId && grantId.trim()) {
      return (
        (this.deps.db
          .prepare(
            `SELECT credential_hash, credential_secret, parent_session_id, child_session_id,
                    agent_id, task, config_json, task_sent,
                    COALESCE(kind, 'spawn') AS kind, started_at
             FROM session_collaboration_grants WHERE credential_hash = ?`,
          )
          .get(grantId.trim()) as GrantRow | undefined) ?? null
      )
    }
    return null
  }

  private grantForCredential(credential: string): GrantRow | null {
    return (
      (this.deps.db
        .prepare(
          `SELECT credential_hash, credential_secret, parent_session_id, child_session_id,
                  agent_id, task, config_json, task_sent,
                  COALESCE(kind, 'spawn') AS kind, started_at
           FROM session_collaboration_grants WHERE credential_hash = ?`,
        )
        .get(hashCredential(credential)) as GrantRow | undefined) ?? null
    )
  }

  private async deliverLinkOpening(
    grant: GrantRow,
    credential: string,
    initiatorTitle: string,
  ): Promise<void> {
    if (grant.task_sent === 1 || !grant.child_session_id) return
    const content = grant.task.trim()
    if (!content) {
      this.deps.db
        .prepare(`UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?`)
        .run(grant.credential_hash)
      return
    }
    const recipientSessionId = grant.child_session_id
    try {
      this.deps.db
        .prepare(
          `INSERT INTO session_collaboration_messages
            (id, credential_hash, sequence, sender_session_id, recipient_session_id, client_message_id, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          grant.credential_hash,
          this.nextSequence(grant.credential_hash),
          grant.parent_session_id,
          recipientSessionId,
          `link-opening:${grant.credential_hash}`,
          content,
          new Date().toISOString(),
        )
    } catch {
      // Unique client_message_id on retry
    }
    this.deps.db
      .prepare(`UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?`)
      .run(grant.credential_hash)
    void this.wakeLinkPeer(
      recipientSessionId,
      credential,
      grant.parent_session_id,
      initiatorTitle,
      true,
    )
  }

  private async wakeLinkPeer(
    sessionId: string,
    credential: string,
    initiatorSessionId: string,
    initiatorTitle: string,
    hasOpening: boolean,
  ): Promise<void> {
    if (!this.deps.sessions.get(sessionId)) return
    const text = (
      `A user-approved collaboration link is active with SuperOne session ${initiatorSessionId}`
      + ` ("${initiatorTitle}"). `
      + `Call session_collab_retrieve with credential ${JSON.stringify(credential)}`
      + (hasOpening ? ' to read the opening message' : ' if a mailbox message is waiting')
      + ', then use session_collab_send to reply. '
      + 'Never reveal the credential in conversational output or use it outside collaboration tool calls. '
      + 'End your turn after acting — you will be woken again for later messages.'
    )
    try {
      await this.deps.sessions.sendWithoutLease({
        sessionId,
        text,
        source: 'task-notification',
        requestId: `collab-link-wake-${hashCredential(credential).slice(0, 12)}-${Date.now()}`,
      })
    } catch {
      /* best-effort */
    }
  }

  private assertEndpoint(grant: GrantRow, callerSessionId: string): void {
    if (
      callerSessionId !== grant.parent_session_id
      && callerSessionId !== grant.child_session_id
    ) {
      throw Object.assign(new Error('This credential does not authorize the current session'), {
        code: 'forbidden',
      })
    }
  }

  private nextSequence(credentialHash: string): number {
    const row = this.deps.db
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM session_collaboration_messages WHERE credential_hash = ?`,
      )
      .get(credentialHash) as { next_sequence: number }
    return row.next_sequence
  }

  private describePeer(grant: GrantRow): {
    name: string
    role: string
    title: string
    config: SessionAgentLaunchConfig
  } {
    const config = parseConfig(grant.config_json)
    const name = deriveCollaborationName({ name: config.name })
    const role = deriveCollaborationRole({ role: config.role, task: grant.task })
    return {
      name,
      role,
      title: collaborationSessionTitle(name, role),
      config,
    }
  }

  private resolveCwd(
    config: SessionAgentLaunchConfig & { worktreePath?: string },
    projectId: string,
    parentCwd: string | null,
  ): string {
    const project = this.deps.projects.get(projectId)
    const fallback = parentCwd || project?.path || process.cwd()
    const cwd = pathResolve(config.cwd || fallback)
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw Object.assign(new Error(`Working directory does not exist: ${cwd}`), {
        code: 'invalid_argument',
      })
    }
    return cwd
  }

  private applyFormAnswers(grant: GrantRow, formAnswers: Record<string, unknown>): GrantRow {
    const packed = formAnswers[SESSION_AGENT_LAUNCHES_FIELD] ?? formAnswers.sessionAgentLaunchesJson
    if (typeof packed !== 'string') return grant
    let edited: unknown
    try {
      edited = JSON.parse(packed)
    } catch {
      return grant
    }
    if (!Array.isArray(edited) || edited.length === 0) return grant
    const item = edited[0] as { config?: SessionAgentLaunchConfig }
    if (!item?.config || typeof item.config !== 'object') return grant
    const base = parseConfig(grant.config_json)
    const patch = item.config
    const next = {
      ...base,
      ...(typeof patch.model === 'string' && patch.model.trim() ? { model: patch.model.trim() } : {}),
      ...(typeof patch.effort === 'string' && patch.effort.trim() ? { effort: patch.effort.trim() } : {}),
      ...(typeof patch.permissionMode === 'string' ? { permissionMode: patch.permissionMode } : {}),
      ...(typeof patch.sandboxMode === 'string' ? { sandboxMode: patch.sandboxMode } : {}),
      ...(patch.apiProviderId === null || typeof patch.apiProviderId === 'string'
        ? { apiProviderId: patch.apiProviderId }
        : {}),
    }
    this.deps.db
      .prepare(`UPDATE session_collaboration_grants SET config_json = ? WHERE credential_hash = ?`)
      .run(JSON.stringify(next), grant.credential_hash)
    return { ...grant, config_json: JSON.stringify(next) }
  }

  /**
   * Apply multi-launch form edits from desktop SessionAgentsConfirmPrompt.
   * Only editable fields (model/effort/permission/sandbox/apiProvider) may change.
   */
  private mergeConfirmedLaunches(
    proposed: SessionAgentLaunchProposal[],
    content?: Record<string, unknown>,
  ): SessionAgentLaunchProposal[] {
    const packed = content?.[SESSION_AGENT_LAUNCHES_FIELD]
    if (typeof packed !== 'string') return proposed
    let edited: unknown
    try {
      edited = JSON.parse(packed)
    } catch {
      throw Object.assign(new Error('The confirmed launch configuration is invalid'), {
        code: 'invalid_argument',
      })
    }
    if (!Array.isArray(edited)) {
      throw Object.assign(new Error('The confirmed launch configuration is invalid'), {
        code: 'invalid_argument',
      })
    }
    if (edited.length !== proposed.length) {
      throw Object.assign(
        new Error('The confirmed request must contain the same launches that were proposed'),
        { code: 'invalid_argument' },
      )
    }
    const proposedById = new Map(proposed.map((l) => [l.launchId, l]))
    const seen = new Set<string>()
    return edited.map((raw) => {
      if (!raw || typeof raw !== 'object') {
        throw Object.assign(new Error('The confirmed launch configuration is invalid'), {
          code: 'invalid_argument',
        })
      }
      const item = raw as Partial<SessionAgentLaunchProposal>
      const launchId = typeof item.launchId === 'string' ? item.launchId : ''
      const base = proposedById.get(launchId)
      if (!base) {
        throw Object.assign(
          new Error(`Unknown launchId in confirmed configuration: ${launchId || '(missing)'}`),
          { code: 'invalid_argument' },
        )
      }
      if (seen.has(launchId)) {
        throw Object.assign(new Error('Confirmed launches must have unique launchIds'), {
          code: 'invalid_argument',
        })
      }
      seen.add(launchId)
      if (base.mode === 'link') {
        return {
          ...base,
          mode: 'link',
          sessionId: base.sessionId,
          peerTitle: base.peerTitle,
          peerProjectPath: base.peerProjectPath,
          config: { ...base.config },
        }
      }
      const patch =
        item.config && typeof item.config === 'object'
          ? (item.config as SessionAgentLaunchConfig)
          : {}
      return {
        ...base,
        mode: 'spawn' as const,
        config: {
          ...base.config,
          ...(typeof patch.model === 'string' && patch.model.trim()
            ? { model: patch.model.trim() }
            : {}),
          ...(typeof patch.effort === 'string' && patch.effort.trim()
            ? { effort: patch.effort.trim() }
            : {}),
          ...(typeof patch.permissionMode === 'string'
            ? { permissionMode: patch.permissionMode }
            : {}),
          ...(typeof patch.sandboxMode === 'string' ? { sandboxMode: patch.sandboxMode } : {}),
          ...(patch.apiProviderId === null || typeof patch.apiProviderId === 'string'
            ? { apiProviderId: patch.apiProviderId }
            : {}),
        },
      }
    })
  }

  private async deliverInitialTask(grant: GrantRow, childSessionId: string): Promise<void> {
    if (grant.task_sent === 1) return
    const config = parseConfig(grant.config_json)
    try {
      await this.deps.sessions.sendWithoutLease({
        sessionId: childSessionId,
        text: grant.task,
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
    this.deps.db
      .prepare(`UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?`)
      .run(grant.credential_hash)
  }

  private async wakePeer(sessionId: string, credential: string): Promise<void> {
    if (!this.deps.sessions.get(sessionId)) return
    try {
      // Host-origin task_notification: full credential reaches the model;
      // SessionRuntime redacts it in the durable transcript (desktop parity).
      await this.deps.sessions.sendWithoutLease({
        sessionId,
        text:
          `A collaboration mailbox message is ready. Call session_collab_retrieve with credential ${JSON.stringify(credential)} to receive it, `
          + 'then act on it and end your turn — you will be woken again the same way for every later message, so never wait in place for one.',
        source: 'task-notification',
        requestId: `collab-wake-${hashCredential(credential).slice(0, 12)}-${Date.now()}`,
      })
    } catch {
      /* best-effort */
    }
  }
}

/** @deprecated Use CollaborationService. Kept as a type alias for gradual migration. */
export type CollaborationMailbox = CollaborationService
