/**
 * session_collab_start: create (spawn/handoff) or bind (link) the approved
 * session and deliver its opening task.
 */

import { randomUUID } from 'crypto'
import { resolve } from 'path'
import type { EffortLevel, PermissionMode, SandboxMode } from '@superone/shared/agent-types'
import {
  HANDOFF_NOTE,
  collaborationSessionTitle,
  collaborationSystemPrompt,
  deriveCollaborationName,
  deriveCollaborationRole,
  describeLaunchedPeer,
  handoffTaskContent,
  parseGrantConfig as parseConfig,
  readOnlyTargetMessage as collaborationTargetReadOnlyMessage,
  type CollaborationGrantRow as GrantRow,
} from '@superone/runtime/collaboration'
import { activateWorktree } from '../git/worktree-ops'
import { getDb } from '../database'
import { createSession as createSessionRecord } from '../db-sessions'
import log from '../logger'
import { listSessionAgentProfiles } from './agent-profiles'
import { collaborationStore as store, notifyCollaborationMailboxChanged } from './collaboration-mailbox'
import { ensureChildProject, isManagedWorktreePath, resolveCwd } from './collaboration-child-project'
import {
  isCollaborationTargetReadOnly,
  notifyCollaborationSessionsChanged,
  resolveCodexServiceTier,
  resolveLiveSession,
  toolResult,
  wakeLinkPeer,
} from './collaboration-host'
import type { Session, SessionManager } from './types'

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
      await deliverLinkOpening(grant, host)
    } else if (!alreadyStarted) {
      // No opening body — still wake the peer so it learns about the link.
      void wakeLinkPeer(host, peerSessionId, grant, false)
      store().markTaskSent(grant.credential_hash)
    } else {
      // Idempotent retry: re-wake without duplicating mailbox.
      void wakeLinkPeer(host, peerSessionId, grant, false)
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
        : { systemPromptAppend: collaborationSystemPrompt(grant.parent_session_id) }),
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
  notifyCollaborationSessionsChanged()
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
async function deliverLinkOpening(grant: GrantRow, host: SessionManager): Promise<void> {
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
  void wakeLinkPeer(host, recipientSessionId, grant, true)
}
