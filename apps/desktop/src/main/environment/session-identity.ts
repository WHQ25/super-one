import { app } from 'electron'
import { loadOrCreateLocalEnvironmentId } from './local-identity'

let identity: string | undefined

/** Stable local identity without initializing the environment gateway registry. */
export function localSessionEnvironmentId(): string {
  return identity ??= loadOrCreateLocalEnvironmentId(app.getPath('userData'))
}
