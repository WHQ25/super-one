import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { pathBasename } from '@superone/shared/collab-request-display'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import type { EnvironmentBucket, EnvironmentConnection, EnvironmentKind } from './types'

export interface SessionHoverModel {
  title: string
  environmentLabel: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath
  /** Null when the session runs in the project checkout. */
  worktreeName: string | null
  lastActiveAt: string
  tags: string[]
}

type HoverEnvironment = Pick<EnvironmentBucket, 'label' | 'kind' | 'connection' | 'path'>

/**
 * Card contents from the session list and the environment bucket. Nothing
 * here issues an RPC.
 */
export function buildSessionHover(input: {
  session: SessionHistoryEntry
  bucket: HoverEnvironment
}): SessionHoverModel {
  const { session } = input
  const worktreeName = session.worktreePath
    ? pathBasename(session.worktreePath)
    : session.isWorktree ? (session.gitBranch ?? null) : null
  return {
    title: session.title,
    environmentLabel: input.bucket.label,
    kind: input.bucket.kind,
    connection: input.bucket.connection,
    ...(input.bucket.path ? { path: input.bucket.path } : {}),
    worktreeName,
    lastActiveAt: session.lastActiveAt,
    tags: session.tags ?? [],
  }
}

export interface SessionPresentation {
  hover: SessionHoverModel
  environmentOffline: boolean
}

function environmentKey(bucket: HoverEnvironment): string {
  return [bucket.label, bucket.kind, bucket.connection, bucket.path ?? ''].join('\n')
}

const presentations = new WeakMap<SessionHistoryEntry, { key: string; value: SessionPresentation }>()

/**
 * The same session row and environment fields return the same object. A bucket
 * replaced because another of its checkouts moved does not render every row again.
 */
export function sessionPresentation(session: SessionHistoryEntry, bucket: HoverEnvironment): SessionPresentation {
  const key = environmentKey(bucket)
  const hit = presentations.get(session)
  if (hit?.key === key) return hit.value
  const value = {
    hover: buildSessionHover({ session, bucket }),
    environmentOffline: bucket.connection === 'offline',
  }
  presentations.set(session, { key, value })
  return value
}

const presenters = new Map<string, (session: SessionHistoryEntry) => SessionPresentation>()

/** One presenter per environment state, so a row's `sessionPresentation` prop keeps its identity. */
export function presenterFor(bucket: HoverEnvironment): (session: SessionHistoryEntry) => SessionPresentation {
  const key = environmentKey(bucket)
  let presenter = presenters.get(key)
  if (!presenter) {
    const environment = { label: bucket.label, kind: bucket.kind, connection: bucket.connection, path: bucket.path }
    presenter = (session) => sessionPresentation(session, environment)
    presenters.set(key, presenter)
  }
  return presenter
}
