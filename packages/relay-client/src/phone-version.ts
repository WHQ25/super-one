import { compareCliVersions } from '@superone/shared/environment/cli-version'
import { PROTOCOL_GENERATION } from '@superone/shared/environment/protocol'
import type { LinkHostInfo } from './phone-link'

/** First desktop release that serves the complete native phone contract. */
export const MIN_PHONE_DESKTOP_VERSION = '0.73.0-alpha.1'

export class DesktopUpgradeRequiredError extends Error {
  readonly code = 'desktop_upgrade_required'
  readonly minimumVersion = MIN_PHONE_DESKTOP_VERSION
  constructor(readonly host?: LinkHostInfo) {
    super(`Upgrade SuperOne on your desktop to ${MIN_PHONE_DESKTOP_VERSION} or later to connect this phone${host?.appVersion ? ` (current: ${host.appVersion})` : ''}.`)
    this.name = 'DesktopUpgradeRequiredError'
  }
}

export function requirePhoneDesktop(host?: LinkHostInfo): asserts host is LinkHostInfo {
  const version = host?.appVersion ?? ''
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  const parsed = semver.exec(version)
  const validPre = parsed && (!parsed[4] || parsed[4].split('.').every(id => !/^\d+$/.test(id) || id === '0' || !id.startsWith('0')))
  if (!host || !host.environmentId || host.protocol !== PROTOCOL_GENERATION.current || !validPre
    || compareCliVersions(version, MIN_PHONE_DESKTOP_VERSION) < 0) throw new DesktopUpgradeRequiredError(host)
}
