/**
 * Spawn children on another machine. The parent's mailbox stays here: the
 * child is created through the environment gateway with an external parent,
 * its mailbox tools come back as Host Actions, and the parent reaches it with
 * `session.send` under the control lease this desktop holds.
 */

import type {
  SessionAgentLaunchConfig,
  SessionAgentProfile,
  SessionAgentRemoteLaunch,
} from '@superone/shared/agent-types'
import type { CollaborationGrantRow } from '@superone/runtime/collaboration'
import { parseGrantConfig } from '@superone/runtime/collaboration'
import type { ProjectSnapshot } from '@superone/shared/environment'
import { normalizeGitRemoteUrl, repoIdentityRemote } from '@superone/shared/git-remote-url'
import { gitRun } from '../git-run'
import { collaborationStore } from './collaboration-mailbox'

/** A connected machine as collaboration sees it. */
export interface RemoteCollabEnvironment {
  environmentId: string
  connectionId: string
  label: string
  connected: boolean
  /** Session harnesses ready on that machine. */
  harnessIds: string[]
}

/** Remote session state the parent reads for retrieve and stall checks. */
export interface RemoteSessionState {
  status: string
  pendingInteraction: unknown
}

/** What remote collaboration needs from the environment layer; production adapts EnvironmentHost. */
export interface RemoteCollaborationPort {
  listEnvironments(): Promise<RemoteCollabEnvironment[]>
  listProjects(connectionId: string): Promise<ProjectSnapshot[]>
  /** Where the node clones a repository it lacks. */
  projectsDir(connectionId: string): Promise<string>
  clone(connectionId: string, input: { remoteUrl: string; parentPath: string }): Promise<ProjectSnapshot>
  activateWorktree(
    connectionId: string,
    projectId: string,
    input: { baseBranch: string; mode: 'branch'; branchName: string },
  ): Promise<{ path: string }>
  createSession(connectionId: string, input: {
    environmentId: string
    projectId: string
    providerId: string
    harnessId: string
    title: string
    cwd: string
    systemPromptAppend: string
    externalParentSessionId: string
    options: Record<string, unknown>
  }): Promise<{ sessionId: string }>
  /** Start a turn under this desktop's lease; resolves once the node accepts it. */
  send(connectionId: string, input: {
    sessionId: string
    text: string
    clientMessageId?: string
    projectPath: string
    providerId?: string
    permissionMode?: string
    model?: string
    effort?: string
  }): Promise<void>
  getSession(connectionId: string, sessionId: string): Promise<RemoteSessionState | null>
}

let port: RemoteCollaborationPort | null = null

/** Tests replace the environment layer; production builds it from EnvironmentHost on first use. */
export function setRemoteCollaborationPort(next: RemoteCollaborationPort | null): void {
  port = next
}

async function remotePort(): Promise<RemoteCollaborationPort> {
  if (!port) {
    const { environmentHostCollaborationPort } = await import('../environment/collaboration-port')
    port = environmentHostCollaborationPort()
  }
  return port
}

function failed(message: string): Error {
  return Object.assign(new Error(message), { code: 'failed_precondition' })
}

/** True when `environment` names this machine (omitted, `local`, or the local environmentId). */
export function isLocalEnvironment(environment: string | undefined, localEnvironmentId?: string): boolean {
  const id = environment?.trim()
  return !id || id === 'local' || id === localEnvironmentId
}

async function connectedEnvironment(environmentId: string): Promise<RemoteCollabEnvironment> {
  const env = (await (await remotePort()).listEnvironments()).find((item) => item.environmentId === environmentId)
  if (!env) throw failed(`Unknown environment ${environmentId}. Pick one from session_collab_list_agents → environments[].`)
  if (!env.connected) throw failed(`${env.label} is not connected. Connect it in Settings → Environments, then request again.`)
  return env
}

/** Connected machines with the local profiles they can run (base harness profiles only). */
export async function listRemoteAgentEnvironments(localProfiles: SessionAgentProfile[]): Promise<Array<{
  environmentId: string
  label: string
  agents: Array<Pick<SessionAgentProfile, 'id' | 'name' | 'harnessId' | 'brandKey' | 'models' | 'efforts'>>
}>> {
  let environments: RemoteCollabEnvironment[]
  try {
    environments = await (await remotePort()).listEnvironments()
  } catch {
    return []
  }
  return environments.filter((env) => env.connected).map((env) => ({
    environmentId: env.environmentId,
    label: env.label,
    agents: localProfiles
      .filter((profile) => profile.id === remoteProviderId(profile.harnessId) && env.harnessIds.includes(profile.harnessId))
      .map(({ id, name, harnessId, brandKey, models, efforts }) => ({ id, name, harnessId, brandKey, models, efforts })),
  }))
}

/** A remote child runs on the target's base provider for its harness; local provider ids mean nothing there. */
export function remoteProviderId(harnessId: string): string {
  return `${harnessId}-base`
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await gitRun(cwd, args)).trim()
  } catch {
    return null
  }
}

/** What the parent's checkout has that a remote child will not see. */
async function localDivergence(cwd: string): Promise<{ upstream: string | null; unpushedCommits: number; uncommittedChanges: number }> {
  const [status, upstream] = await Promise.all([
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
  ])
  const ahead = upstream
    ? await git(cwd, ['rev-list', '--count', '@{u}..HEAD'])
    : await git(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  return {
    upstream,
    unpushedCommits: Number(ahead) || 0,
    uncommittedChanges: status ? status.split('\n').filter(Boolean).length : 0,
  }
}

function matchProject(projects: ProjectSnapshot[], repository: string): ProjectSnapshot | undefined {
  return projects.find((project) => repoIdentityRemote(project.repoIdentity) === repository)
}

/**
 * Resolve where a spawn child of the session at `cwd` runs on `environmentId`:
 * the target's checkout of the same origin, or a clone into its projects
 * directory. A project without an origin remote cannot run elsewhere.
 */
export async function planRemoteLaunch(cwd: string, environmentId: string): Promise<SessionAgentRemoteLaunch> {
  const env = await connectedEnvironment(environmentId)
  const cloneUrl = await git(cwd, ['config', '--get', 'remote.origin.url'])
  const repository = normalizeGitRemoteUrl(cloneUrl)
  if (!cloneUrl || !repository) {
    throw failed(
      'This project has no origin remote, so another machine cannot get its code. '
      + 'Push it to a remote first, or launch the child on this machine.',
    )
  }
  const p = await remotePort()
  const [projects, divergence] = await Promise.all([p.listProjects(env.connectionId), localDivergence(cwd)])
  const project = matchProject(projects, repository)
  // The child sees what is pushed: the branch's upstream, else the remote's default branch.
  const baseRef = divergence.upstream?.startsWith('origin/') ? divergence.upstream : 'origin/HEAD'
  return {
    environmentId,
    label: env.label,
    repository,
    cloneUrl,
    ...(project
      ? { projectId: project.projectId, projectPath: project.path }
      : { cloneInto: await p.projectsDir(env.connectionId) }),
    baseRef,
    unpushedCommits: divergence.unpushedCommits,
    uncommittedChanges: divergence.uncommittedChanges,
  }
}

function branchSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'agent'
}

function isUnsupported(error: unknown): boolean {
  return (error as { details?: { unsupported?: unknown } } | null)?.details?.unsupported === true
}

export interface StartedRemoteChild {
  sessionId: string
  connectionId: string
  projectPath: string
  cwd: string
  branch: string | null
}

/**
 * Create the approved remote child: clone when the target still lacks the
 * repository, cut a fresh worktree branch, and create the session with the
 * collaboration prompt and its external parent. The task is sent separately.
 */
export async function startRemoteChild(input: {
  grant: CollaborationGrantRow
  config: SessionAgentLaunchConfig & { remote: SessionAgentRemoteLaunch }
  harnessId: string
  title: string
  systemPromptAppend: string
}): Promise<StartedRemoteChild> {
  const { remote } = input.config
  const env = await connectedEnvironment(remote.environmentId)
  const p = await remotePort()
  // Re-resolve: the target may have opened or cloned the repository since approval.
  let project = matchProject(await p.listProjects(env.connectionId), remote.repository)
  if (!project) {
    if (!remote.cloneInto) throw failed(`${env.label} no longer has a checkout of ${remote.repository}`)
    project = await p.clone(env.connectionId, { remoteUrl: remote.cloneUrl, parentPath: remote.cloneInto })
  }
  const branch = input.config.worktree?.branchName?.trim()
    || `superone/${branchSlug(input.config.name ?? 'agent')}-${input.grant.grant_id.slice(0, 8)}`
  let cwd = project.path
  let createdBranch: string | null = branch
  try {
    cwd = (await p.activateWorktree(env.connectionId, project.projectId, {
      baseBranch: remote.baseRef,
      mode: 'branch',
      branchName: branch,
    })).path
  } catch (error) {
    // A node that cannot cut worktrees runs the child in its checkout.
    if (!isUnsupported(error)) {
      throw failed(
        `Could not create a worktree from ${remote.baseRef} on ${env.label}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      )
    }
    createdBranch = null
  }
  const { sessionId } = await p.createSession(env.connectionId, {
    environmentId: remote.environmentId,
    projectId: project.projectId,
    // Remote launches only use base profiles, whose id is the same on every machine.
    providerId: input.grant.agent_id,
    harnessId: input.harnessId,
    title: input.title,
    cwd,
    systemPromptAppend: input.systemPromptAppend,
    externalParentSessionId: input.grant.parent_session_id,
    options: {
      harnessId: input.harnessId,
      ...(input.config.model ? { model: input.config.model } : {}),
      ...(input.config.effort ? { effort: input.config.effort } : {}),
      ...(input.config.permissionMode ? { permissionMode: input.config.permissionMode } : {}),
      ...(input.config.sandboxMode ? { sandboxMode: input.config.sandboxMode } : {}),
    },
  })
  return { sessionId, connectionId: env.connectionId, projectPath: project.path, cwd, branch: createdBranch }
}

/** The remote target of a spawn child, or null for a local child or any other session. */
export function remoteChildTarget(childSessionId: string): SessionAgentRemoteLaunch | null {
  const grant = collaborationStore().spawnGrantForChild(childSessionId)
  return grant ? parseGrantConfig(grant.config_json).remote ?? null : null
}

/** Start a turn in a remote child (its task or a wake) under this desktop's lease. */
export async function sendToRemoteChild(
  childSessionId: string,
  text: string,
  options: { clientMessageId?: string } = {},
): Promise<void> {
  const grant = collaborationStore().spawnGrantForChild(childSessionId)
  const config = grant ? parseGrantConfig(grant.config_json) : null
  if (!grant || !config?.remote) throw failed(`${childSessionId} is not a remote collaboration child`)
  const env = await connectedEnvironment(config.remote.environmentId)
  const { remoteProjectKey } = await import('@superone/shared/remote-resource-key')
  await (await remotePort()).send(env.connectionId, {
    sessionId: childSessionId,
    text,
    ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
    projectPath: remoteProjectKey(env.connectionId, config.remote.projectPath ?? ''),
    providerId: grant.agent_id,
    ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.effort ? { effort: config.effort } : {}),
  })
}

/** Status of a remote child as its node reports it; null when the node cannot be reached. */
export async function remoteChildState(childSessionId: string): Promise<RemoteSessionState | null> {
  const target = remoteChildTarget(childSessionId)
  if (!target) return null
  try {
    const env = await connectedEnvironment(target.environmentId)
    return await (await remotePort()).getSession(env.connectionId, childSessionId)
  } catch {
    return null
  }
}
