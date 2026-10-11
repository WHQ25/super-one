import type { MobileAppDownloads } from '@superone/shared/mobile-updates'

/** Story fixtures: what the alpha and stable manifests carried on 2026-10-11. */
export const ALPHA_DOWNLOADS: MobileAppDownloads = {
  track: 'alpha',
  android: { version: '1.0.0', buildCode: 36, url: 'https://dl.super-one.dev/mobile/android/alpha/superone-v1.0.0-build36.apk' },
  ios: { version: '1.0.0', buildCode: 36, url: 'https://testflight.apple.com/join/ed1GMKs4' },
}

export const STABLE_DOWNLOADS: MobileAppDownloads = {
  track: 'stable',
  android: { version: '1.0.0', buildCode: 34, url: 'https://dl.super-one.dev/mobile/android/superone-v1.0.0-build34.apk' },
  ios: { version: '1.0.0', buildCode: 34, url: 'https://testflight.apple.com/join/3VVS4EsT' },
}
