import {
  fetchMobileUpdateManifest,
  mobileAppDownload,
  type MobileAppDownloads,
  type MobileUpdateTrack,
} from '@superone/shared/mobile-updates'
import type { VariantId } from './variant'

/**
 * The phone line this desktop pairs with. Only stable phones are built to
 * serve a stable desktop; alpha and dev desktops run the newer protocol the
 * alpha phones speak.
 */
export function mobileTrackForVariant(id: VariantId): MobileUpdateTrack {
  return id === 'stable' ? 'stable' : 'alpha'
}

/**
 * Install links for this desktop's phone apps, read from the same manifests
 * the apps update from. In main because the release CDN sends no CORS headers.
 */
export async function getMobileAppDownloads(
  track: MobileUpdateTrack,
  fetchManifest: typeof fetchMobileUpdateManifest = fetchMobileUpdateManifest,
): Promise<MobileAppDownloads> {
  const [android, ios] = await Promise.all([
    fetchManifest({ platform: 'android', track }),
    fetchManifest({ platform: 'ios', track }),
  ])
  return { track, android: mobileAppDownload(android), ios: mobileAppDownload(ios) }
}
