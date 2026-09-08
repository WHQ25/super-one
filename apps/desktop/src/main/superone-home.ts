import { app } from 'electron'
import { homedir } from 'node:os'
import { resolveProjectSuperoneHome, resolveSuperoneHome } from '@superone/runtime/fs/superone-home'
import { variantId } from './variant'

/** Personal data follows the packaged identity, never its version string. */
export function superoneHome(): string {
  let userHome: string
  try { userHome = app.getPath('home') } catch { userHome = homedir() }
  return resolveSuperoneHome({ userHome, variant: variantId() })
}

/** Project data uses the same variant namespace as personal data. */
export function projectSuperoneHome(projectRoot: string): string {
  return resolveProjectSuperoneHome(projectRoot, variantId())
}
