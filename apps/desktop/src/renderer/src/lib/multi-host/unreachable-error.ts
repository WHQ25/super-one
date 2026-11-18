import type { EnvironmentConnection, LoadStatus } from './types'

/**
 * `listProjects` failed because the node socket is down. Electron wraps the
 * transport error as `Error invoking remote method '…': Error: not connected`.
 * A refused catalog stays visible; this one is drawn as offline instead.
 */
const UNREACHABLE_ERROR_RE = /(?:^|:\s*)(?:Error:\s*)?(?:environment is )?not connected\s*$/i

export function isRemoteUnreachableError(message: string | null | undefined): boolean {
  return typeof message === 'string' && UNREACHABLE_ERROR_RE.test(message.trim())
}

/**
 * The supervisor still lists the host as live, but the project list already
 * failed with a dead socket. Explicit offline rows are a different control.
 */
export function environmentUnreachable(bucket: {
  connection: EnvironmentConnection
  projectsStatus?: LoadStatus
  projectsError?: string | null
}): boolean {
  return bucket.connection !== 'offline'
    && bucket.projectsStatus === 'error'
    && isRemoteUnreachableError(bucket.projectsError)
}
