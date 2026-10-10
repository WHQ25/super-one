import { app } from 'electron'
import { loadDesktopEnvironmentIdentity, type DesktopEnvironmentIdentity } from './local-identity'

let identity: DesktopEnvironmentIdentity | undefined

function load(): DesktopEnvironmentIdentity {
  return identity ??= loadDesktopEnvironmentIdentity(app.getPath('userData'))
}

/** This desktop's environment id, without initializing the environment gateway registry. */
export function localSessionEnvironmentId(): string {
  return load().environmentId
}

/** This desktop's earlier ids (see `loadDesktopEnvironmentIdentity`). */
export function localEnvironmentAliases(): string[] {
  return load().aliases
}
