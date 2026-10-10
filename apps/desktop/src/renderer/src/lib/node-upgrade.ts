import type { TFunction } from 'i18next'
import type { NodeUpgradeAvailability } from '@superone/shared/environment'

/** The versions an upgrade notice names; a node refused for its protocol has not reported one. */
export function nodeUpgradeVersions(upgrade: NodeUpgradeAvailability, t: TFunction) {
  return {
    remoteVersion: upgrade.remoteVersion ?? t('settings.environments.olderProtocolVersion'),
    targetVersion: upgrade.targetVersion,
  }
}
