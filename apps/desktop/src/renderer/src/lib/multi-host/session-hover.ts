import type { SessionHistoryEntry, WorktreeEntry } from '@superone/shared/agent-types'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import { hostPathsEqual, parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { EnvironmentBucket, EnvironmentConnection, EnvironmentKind } from './types'

export interface SessionHoverModel {
  title: string
  /** Null when the caller has no project to name. */
  projectName: string | null
  environmentLabel: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath
  /**
   * Branch name for a worktree that has one. Null on the project checkout,
   * and null while a detached worktree's commit is still unresolved.
   */
  worktreeName: string | null
  /** Linked worktree directory. Omitted for a session in the project checkout. */
  worktreePath?: string
  /** Project key (`remote:` or a local path) used to read that worktree's HEAD. */
  projectPath?: string
  /** Commit icon when the label is a detached HEAD rather than a branch. */
  checkoutKind?: 'commit'
  lastActiveAt: string
  tags: string[]
}

export type WorktreeCheckoutLabel =
  | { kind: 'branch'; name: string }
  | { kind: 'commit'; hash: string }
  | { kind: 'detached' }

/** `git worktree list` root: a remote project key, otherwise the worktree directory itself. */
export function worktreeInfoRoot(projectPath: string | null | undefined, worktreePath: string): string {
  if (parseRemoteProjectKey(worktreePath)) return worktreePath
  if (projectPath && parseRemoteProjectKey(projectPath)) return projectPath
  return worktreePath
}

function sameCheckoutPath(entryPath: string, worktreePath: string): boolean {
  const entryHost = parseRemoteProjectKey(entryPath)?.path ?? entryPath
  const worktreeHost = parseRemoteProjectKey(worktreePath)?.path ?? worktreePath
  return hostPathsEqual(entryHost, worktreeHost)
}

/**
 * Same label as the workdir chip: the branch when one is checked out, otherwise
 * the short HEAD. Null when this path is not in the list.
 */
export function worktreeCheckoutLabel(
  entries: ReadonlyArray<Pick<WorktreeEntry, 'path' | 'branch' | 'head'>> | undefined,
  worktreePath: string,
): WorktreeCheckoutLabel | null {
  const entry = entries?.find((candidate) => sameCheckoutPath(candidate.path, worktreePath))
  if (!entry) return null
  const branch = entry.branch.trim()
  if (branch) return { kind: 'branch', name: branch }
  const hash = entry.head.trim().slice(0, 7)
  return hash ? { kind: 'commit', hash } : { kind: 'detached' }
}

type HoverEnvironment = Pick<EnvironmentBucket, 'label' | 'kind' | 'connection' | 'path'>

/**
 * Card contents from the session list and the environment bucket. Nothing
 * here issues an RPC.
 */
export function buildSessionHover(input: {
  session: SessionHistoryEntry
  bucket: HoverEnvironment
  projectName?: string | null
  projectPath?: string | null
}): SessionHoverModel {
  const { session } = input
  const onWorktree = Boolean(session.worktreePath) || session.isWorktree === true
  const branch = onWorktree ? session.gitBranch?.trim() || null : null
  return {
    title: session.title,
    projectName: input.projectName ?? null,
    environmentLabel: input.bucket.label,
    kind: input.bucket.kind,
    connection: input.bucket.connection,
    ...(input.bucket.path ? { path: input.bucket.path } : {}),
    worktreeName: branch,
    ...(onWorktree && session.worktreePath ? { worktreePath: session.worktreePath } : {}),
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    lastActiveAt: session.lastActiveAt,
    tags: session.tags ?? [],
  }
}

export interface SessionPresentation {
  hover: SessionHoverModel
  environmentOffline: boolean
}

function environmentKey(bucket: HoverEnvironment, projectName: string | null, projectPath: string | null): string {
  return [bucket.label, bucket.kind, bucket.connection, bucket.path ?? '', projectName ?? '', projectPath ?? ''].join('\n')
}

const presentations = new WeakMap<SessionHistoryEntry, { key: string; value: SessionPresentation }>()

/**
 * The same session row and environment fields return the same object. A bucket
 * replaced because another of its checkouts moved does not render every row again.
 */
export function sessionPresentation(
  session: SessionHistoryEntry,
  bucket: HoverEnvironment,
  projectName: string | null = null,
  projectPath: string | null = null,
): SessionPresentation {
  const key = [
    environmentKey(bucket, projectName, projectPath),
    session.gitBranch ?? '',
    session.worktreePath ?? '',
    session.isWorktree ? '1' : '0',
  ].join('\n')
  const hit = presentations.get(session)
  if (hit?.key === key) return hit.value
  const value = {
    hover: buildSessionHover({ session, bucket, projectName, projectPath }),
    environmentOffline: bucket.connection === 'offline',
  }
  presentations.set(session, { key, value })
  return value
}

const presenters = new Map<string, (session: SessionHistoryEntry) => SessionPresentation>()

/** One presenter per environment state and project, so a row's `sessionPresentation` prop keeps its identity. */
export function presenterFor(
  bucket: HoverEnvironment,
  projectName: string | null = null,
  projectPath: string | null = null,
): (session: SessionHistoryEntry) => SessionPresentation {
  const key = environmentKey(bucket, projectName, projectPath)
  let presenter = presenters.get(key)
  if (!presenter) {
    const environment = { label: bucket.label, kind: bucket.kind, connection: bucket.connection, path: bucket.path }
    presenter = (session) => sessionPresentation(session, environment, projectName, projectPath)
    presenters.set(key, presenter)
  }
  return presenter
}
