import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { refreshEnvironmentCheckouts } from '@/lib/multi-host/refresh-environment'
import type { EnvironmentBucket, EnvironmentKind, HostCheckout } from '@/lib/multi-host/types'
import { repoIdentityRemote } from '@superone/shared/git-remote-url'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import { parseRemoteProjectKey, remoteProjectKey } from '@superone/shared/remote-resource-key'
import { environmentIdForProjectKey } from '@superone/shared/session-location'
import { switchComposerToCheckout } from './composer-location'

export type WorkDirEnvironmentRowKind =
  | 'current'
  | 'selectable'
  | 'needs-upgrade'
  | 'clone-here'
  | 'offline'
  | 'not-a-git-repo'
  | 'no-origin'

export interface WorkDirEnvironmentOption {
  environmentId: string
  connectionId: string
  label: string
  kind: WorkDirEnvironmentRowKind
  needsUpgrade: boolean
  /** Local, CLI node, or remote desktop. Omitted by older fixtures. */
  hostKind?: EnvironmentKind
  /** How a connected remote is reached, for its icon. */
  path?: NodeLinkPath
}

type EnvironmentSource = Pick<EnvironmentBucket, 'environmentId' | 'connectionId' | 'label' | 'connection' | 'checkouts'> & {
  kind?: EnvironmentKind
  path?: NodeLinkPath
}

function isCurrent(bucket: { environmentId: string; connectionId: string }, currentEnvironmentId: string): boolean {
  return bucket.environmentId === currentEnvironmentId || bucket.connectionId === currentEnvironmentId
}

/**
 * Rows for the environment dropdown. Offline wins, including over the current
 * row. A project that is not a git repo cannot move. A checkout with no origin
 * cannot be cloned. A missing checkout of the same origin is Clone Here.
 */
/** One local row when the catalog has not loaded, so the chip still names this machine. */
export function environmentRowsOrLocal(
  options: WorkDirEnvironmentOption[],
  localLabel: string,
): WorkDirEnvironmentOption[] {
  if (options.length > 0) return options
  return [{
    environmentId: 'local',
    connectionId: 'local',
    label: localLabel,
    kind: 'current',
    needsUpgrade: false,
    hostKind: 'local',
  }]
}

export function workDirEnvironmentOptions(input: {
  buckets: EnvironmentSource[]
  currentEnvironmentId: string
  repoIdentity: string | null
  isGitRepo: boolean
}): WorkDirEnvironmentOption[] {
  const remote = repoIdentityRemote(input.repoIdentity)
  return input.buckets.map((bucket) => {
    const needsUpgrade = bucket.connection === 'needs-upgrade'
    const hasCheckout = !!remote && bucket.checkouts.some((checkout) => repoIdentityRemote(checkout.repoIdentity) === remote)
    let kind: WorkDirEnvironmentRowKind = 'selectable'
    if (bucket.connection === 'offline') kind = 'offline'
    else if (isCurrent(bucket, input.currentEnvironmentId)) kind = 'current'
    else if (!input.isGitRepo) kind = 'not-a-git-repo'
    else if (!remote) kind = 'no-origin'
    else if (!hasCheckout) kind = 'clone-here'
    else if (needsUpgrade) kind = 'needs-upgrade'
    return {
      environmentId: bucket.environmentId,
      connectionId: bucket.connectionId,
      label: bucket.label,
      kind,
      needsUpgrade,
      hostKind: bucket.kind,
      ...(bucket.path ? { path: bucket.path } : {}),
    }
  })
}

export function useWorkDirEnvironmentMenu(projectPath: string | null, isGitRepo: boolean | null | undefined) {
  const buckets = useMultiHostSidebarStore((s) => s.environments)
  const checkout = projectPath
    ? buckets.flatMap((bucket) => bucket.checkouts).find((item) => item.pathKey === projectPath) ?? null
    : null
  const currentEnvironmentId = checkout?.environmentId ?? environmentIdForProjectKey(projectPath)
  const repoIdentity = checkout?.repoIdentity ?? null
  return {
    buckets,
    repoIdentity,
    currentEnvironmentId,
    options: workDirEnvironmentOptions({
      buckets,
      currentEnvironmentId,
      repoIdentity,
      isGitRepo: isGitRepo !== false,
    }),
  }
}

export function projectDirectoryName(projectPath: string | null | undefined): string {
  const hostPath = parseRemoteProjectKey(projectPath ?? '')?.path ?? projectPath ?? ''
  const trimmed = hostPath.replace(/[/\\]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed) || 'project'
}

export function checkoutOnEnvironment(
  buckets: EnvironmentSource[],
  environmentId: string,
  repoIdentity: string | null,
): HostCheckout | null {
  const bucket = buckets.find((item) => item.environmentId === environmentId || item.connectionId === environmentId)
  if (!bucket) return null
  const remote = repoIdentityRemote(repoIdentity)
  if (!remote) return null
  return bucket.checkouts.find((checkout) => repoIdentityRemote(checkout.repoIdentity) === remote) ?? null
}

async function localProjectsDir(connectionId: string): Promise<string> {
  try {
    const settings = await window.app.getAppSettings()
    const saved = settings.defaultClonePaths?.[connectionId]?.trim()
    if (saved) return saved
  } catch {
    // The node's default is only for a remote clone. Local still needs a parent.
  }
  return '~/SuperOne/Projects'
}

/** Clone this repo onto an environment, then open that checkout at its root. */
export async function cloneAndOpenCheckout(input: {
  connectionId: string
  environmentId: string
  repoIdentity: string
  directoryName: string
}): Promise<void> {
  const remoteUrl = repoIdentityRemote(input.repoIdentity)
  if (!remoteUrl) throw new Error('This repository has no origin to clone.')
  const parentPath = input.connectionId === 'local' ? await localProjectsDir(input.connectionId) : ''
  const project = await window.environment.cloneRepository(input.connectionId, {
    remoteUrl,
    parentPath,
    directoryName: input.directoryName,
    ifExists: 'reuse-or-rename',
  })
  await refreshEnvironmentCheckouts(input.connectionId)
  const pathKey = input.connectionId === 'local'
    ? project.path
    : remoteProjectKey(input.connectionId, project.path)
  await switchComposerToCheckout({
    pathKey,
    connectionId: input.connectionId,
    projectId: project.projectId,
    environmentId: input.environmentId,
  })
}
