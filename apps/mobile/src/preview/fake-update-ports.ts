import type { MobileUpdateManifest } from '@superone/shared/mobile-updates'
import type { OtaPorts, UpdatePorts } from '../updates/update-ports'
import { UpdateDownloadError, type DownloadFailure } from '../updates/update-download-state'
import { OTA_IDLE, type OtaNativeState } from '../updates/ota-update-state'

export type FakeUpdateAction =
  | 'fetchManifest'
  | 'download'
  | 'cancel'
  | 'install'
  | 'openUnknownSourcesSettings'
  | 'openTestFlight'
  | 'otaCheckAndFetch'
  | 'otaReload'

/**
 * A manifest shaped like the one R2 serves, so the gallery and the stories
 * exercise the same parse-validated fields the app would receive.
 */
export function fakeAndroidManifest(overrides: Partial<MobileUpdateManifest> = {}): MobileUpdateManifest {
  return {
    schemaVersion: 1,
    platform: 'android',
    version: '1.1.0',
    buildCode: 48,
    minSupportedBuildCode: 30,
    releasedAt: '2026-09-11T00:00:00.000Z',
    artifact: {
      url: 'https://dl.super-one.dev/mobile/android/superone-v1.0.0-build42.apk',
      md5: '0123456789abcdef0123456789abcdef',
      sizeBytes: 96_468_992,
    },
    ...overrides,
  }
}

export function fakeIosManifest(overrides: Partial<MobileUpdateManifest> = {}): MobileUpdateManifest {
  return {
    schemaVersion: 1,
    platform: 'ios',
    version: '1.1.0',
    buildCode: 48,
    minSupportedBuildCode: 30,
    releasedAt: '2026-09-11T00:00:00.000Z',
    testflightUrl: 'https://testflight.apple.com/join/superone',
    ...overrides,
  }
}

/**
 * Update ports that never touch the network, the file system or an intent.
 *
 * The download walks a scripted progress ramp so the gallery can show a real
 * moving bar, and every failure the UI has wording for can be requested by
 * name rather than provoked.
 */
/**
 * OTA ports whose native state is a value the caller pushes, so a scripted
 * lifecycle -- available, downloading, pending, restarting -- can be replayed
 * in the gallery and the tests without a bundle ever being published.
 */
export function createFakeOtaPorts(
  options: { enabled?: boolean; initial?: OtaNativeState; onCall?: (action: FakeUpdateAction) => void } = {},
): OtaPorts & { push: (state: OtaNativeState) => void } {
  let current = options.initial ?? OTA_IDLE
  const listeners = new Set<(state: OtaNativeState) => void>()
  return {
    enabled: options.enabled ?? true,
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async checkAndFetch() {
      options.onCall?.('otaCheckAndFetch')
    },
    async reload() {
      options.onCall?.('otaReload')
    },
    push(state) {
      current = state
      for (const listener of listeners) listener(state)
    },
  }
}

export function createFakeUpdatePorts(
  options: {
    manifest?: MobileUpdateManifest | null
    currentBuildCode?: number | null
    canSelfInstall?: boolean
    downloadFailure?: DownloadFailure
    installFailure?: boolean
    /** Milliseconds between progress ticks; 0 finishes almost immediately. */
    tickMs?: number
    onCall?: (action: FakeUpdateAction) => void
    ota?: OtaPorts
  } = {},
): UpdatePorts {
  const manifest = options.manifest === undefined ? fakeAndroidManifest() : options.manifest
  const platform = manifest?.platform ?? 'android'
  const tickMs = options.tickMs ?? 120

  return {
    ota: options.ota ?? createFakeOtaPorts({ enabled: false, onCall: options.onCall }),
    environment: {
      platform,
      currentBuild: {
        version: '1.0.0',
        buildCode: options.currentBuildCode === undefined ? 42 : options.currentBuildCode,
      },
      canSelfInstall: options.canSelfInstall ?? platform === 'android',
    },

    async fetchManifest() {
      options.onCall?.('fetchManifest')
      return manifest
    },

    freeDiskBytes() {
      return 8 * 1024 * 1024 * 1024
    },

    download(target, onProgress) {
      options.onCall?.('download')
      let cancelled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const result = new Promise<{ fileUri: string; contentUri: string }>((resolve, reject) => {
        let step = 0
        const tick = () => {
          if (cancelled) {
            reject(new UpdateDownloadError('cancelled'))
            return
          }
          step += 1
          onProgress(Math.min(1, step / 10))
          if (step < 10) {
            timer = setTimeout(tick, tickMs)
            return
          }
          if (options.downloadFailure) {
            reject(new UpdateDownloadError(options.downloadFailure))
            return
          }
          resolve({
            fileUri: `file:///fake/superone-${target.buildCode}.apk`,
            contentUri: `content://fake/superone-${target.buildCode}.apk`,
          })
        }
        timer = setTimeout(tick, tickMs)
      })

      return {
        result,
        cancel: () => {
          options.onCall?.('cancel')
          cancelled = true
          if (timer) clearTimeout(timer)
        },
      }
    },

    async install() {
      options.onCall?.('install')
      if (options.installFailure) throw new Error('No Activity found to handle Intent')
    },

    async openUnknownSourcesSettings() {
      options.onCall?.('openUnknownSourcesSettings')
    },

    async openTestFlight() {
      options.onCall?.('openTestFlight')
    },

    clearStaleDownloads() {},
  }
}
