import * as Application from 'expo-application'
import { Directory, File, Paths } from 'expo-file-system'
import { createDownloadResumable } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Updates from 'expo-updates'
import { Linking, Platform } from 'react-native'
import {
  fetchMobileUpdateManifest,
  type MobileUpdateManifest,
  type MobileUpdatePlatform,
} from '@superone/shared/mobile-updates'
import { downloadFraction, UpdateDownloadError, verifyDownload } from './update-download-state'
import { OTA_IDLE, type OtaNativeState } from './ota-update-state'

/**
 * Everything the updater needs from the phone, injected rather than imported
 * so the gate and its stories can run under jest, Storybook and the native
 * preview without any of the native modules behind it.
 *
 * This is the only module in `src/` that touches `expo-updates`; keeping the
 * import here means the jest suites never load it.
 */

/** Where a downloaded APK is parked. The cache is the OS's to reclaim. */
const CACHE_DIRECTORY = 'updates'

/** FLAG_GRANT_READ_URI_PERMISSION -- the installer reads our content:// URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 0x1

const APK_MIME_TYPE = 'application/vnd.android.package-archive'

/**
 * Deprecated since API 29 and still the action the system installer handles.
 * `ACTION_VIEW` is the documented alternative but leans on the provider
 * returning a MIME type for `.apk`, which many devices do not, leaving the
 * intent unresolvable.
 */
const ACTION_INSTALL_PACKAGE = 'android.intent.action.INSTALL_PACKAGE'

export type UpdateBuildInfo = {
  /** `CFBundleShortVersionString` / `versionName`, for display only. */
  version: string | null
  /** Android `versionCode` / iOS `CFBundleVersion`, the compared number. */
  buildCode: number | null
}

export type UpdateEnvironment = {
  platform: MobileUpdatePlatform
  currentBuild: UpdateBuildInfo
  /**
   * Whether this binary may fetch and install its own APK.
   *
   * False for iOS (impossible), for dev clients and Metro-served builds (they
   * are signed with the local debug keystore, so an EAS-signed APK could not
   * install over them anyway), and for any channel but `internal` (the store
   * build must never sideload).
   */
  canSelfInstall: boolean
}

export type DownloadedUpdate = {
  fileUri: string
  /** Android content:// URI, the only form the installer will accept. */
  contentUri: string
}

export type UpdateDownload = {
  result: Promise<DownloadedUpdate>
  cancel: () => void
}

/**
 * The JS-bundle updater. expo-updates checks and downloads on its own at
 * launch; these ports expose that lifecycle and add the two things it does not
 * do by itself -- re-check when the app comes back to the foreground, and
 * restart onto the downloaded bundle.
 */
export interface OtaPorts {
  /** False in dev clients and Metro-served builds, where there is no bundle to update. */
  enabled: boolean
  snapshot(): OtaNativeState
  subscribe(listener: (state: OtaNativeState) => void): () => void
  /** Check and, when something is published, download it. Resolves once the native side has it. */
  checkAndFetch(): Promise<void>
  /** Restart onto the downloaded bundle. Resolving means the restart was refused, not that it happened. */
  reload(): Promise<void>
}

export interface UpdatePorts {
  environment: UpdateEnvironment
  ota: OtaPorts
  fetchManifest(): Promise<MobileUpdateManifest | null>
  /** Free bytes on the volume the download lands on, or null if unreadable. */
  freeDiskBytes(): number | null
  download(manifest: MobileUpdateManifest, onProgress: (fraction: number | null) => void): UpdateDownload
  /**
   * Hand the APK to the system installer.
   *
   * Resolving means the installer was launched, not that the install
   * succeeded: `startActivityForResult` returns as soon as the installer
   * appears, and on a successful self-update this process is killed outright.
   * Rejecting means no activity would take the intent at all.
   */
  install(downloaded: DownloadedUpdate): Promise<void>
  /** The per-source "install unknown apps" toggle, which we cannot pre-check. */
  openUnknownSourcesSettings(): Promise<void>
  openTestFlight(url: string): Promise<void>
  /** Drop APKs left behind by an earlier session. */
  clearStaleDownloads(): void
}

function readCurrentBuild(): UpdateBuildInfo {
  // `nativeBuildVersion` is a string on both platforms, and `null` when it
  // cannot be read -- which must stay null rather than becoming NaN, because
  // the gate refuses to block on an unreadable build number.
  const raw = Application.nativeBuildVersion
  const parsed = raw === null ? Number.NaN : Number(raw)
  return {
    version: Application.nativeApplicationVersion,
    buildCode: Number.isSafeInteger(parsed) ? parsed : null,
  }
}

function resolveEnvironment(): UpdateEnvironment {
  const platform: MobileUpdatePlatform = Platform.OS === 'android' ? 'android' : 'ios'
  const currentBuild = readCurrentBuild()
  const canSelfInstall =
    Platform.OS === 'android'
    && !__DEV__
    && process.env.EXPO_PUBLIC_NATIVE_PREVIEW !== '1'
    // `isEnabled` is false in a dev client, which is exactly the build whose
    // debug-keystore signature would reject an EAS-signed APK.
    && Updates.isEnabled
    && Updates.channel === 'internal'
    && currentBuild.buildCode !== null
  return { platform, currentBuild, canSelfInstall }
}

function updatesDirectory(): Directory {
  return new Directory(Paths.cache, CACHE_DIRECTORY)
}

function otaStateFrom(context: Updates.UpdatesNativeStateMachineContext | undefined): OtaNativeState {
  if (!context) return OTA_IDLE
  return {
    isUpdateAvailable: context.isUpdateAvailable,
    isDownloading: context.isDownloading,
    isUpdatePending: context.isUpdatePending,
    isRestarting: context.isRestarting,
    downloadProgress: context.downloadProgress,
    hasDownloadError: context.downloadError !== undefined,
  }
}

function createOtaPorts(): OtaPorts {
  const enabled = Updates.isEnabled && !__DEV__ && process.env.EXPO_PUBLIC_NATIVE_PREVIEW !== '1'
  return {
    enabled,
    snapshot: () => otaStateFrom(Updates.latestContext),
    subscribe(listener) {
      const subscription = Updates.addUpdatesStateChangeListener((event) => listener(otaStateFrom(event.context)))
      return () => subscription.remove()
    },
    async checkAndFetch() {
      const result = await Updates.checkForUpdateAsync()
      if (result.isAvailable) await Updates.fetchUpdateAsync()
    },
    reload: () => Updates.reloadAsync(),
  }
}

export function createUpdatePorts(): UpdatePorts {
  const environment = resolveEnvironment()

  return {
    environment,
    ota: createOtaPorts(),

    async fetchManifest() {
      return fetchMobileUpdateManifest({ platform: environment.platform })
    },

    freeDiskBytes() {
      try {
        const free = Paths.availableDiskSpace
        return Number.isFinite(free) ? free : null
      } catch {
        return null
      }
    },

    download(manifest, onProgress) {
      const artifact = manifest.artifact
      if (!artifact) throw new Error('manifest carries no artifact to download')

      const directory = updatesDirectory()
      directory.create({ intermediates: true, idempotent: true })
      const fileUri = `${directory.uri.replace(/\/+$/, '')}/superone-${manifest.buildCode}.apk`
      // A partial file from an interrupted attempt would otherwise make the
      // resumable pick up mid-stream against a URL it never started.
      const existing = new File(fileUri)
      if (existing.exists) existing.delete()

      const resumable = createDownloadResumable(
        artifact.url,
        fileUri,
        // Hashing natively during the download beats reading `File.md5`
        // afterwards, which is a synchronous getter that would block the JS
        // thread over a couple hundred megabytes.
        { md5: true },
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          onProgress(downloadFraction(totalBytesWritten, totalBytesExpectedToWrite, artifact.sizeBytes))
        },
      )

      const result = (async (): Promise<DownloadedUpdate> => {
        const download = await resumable.downloadAsync()
        if (!download) throw new UpdateDownloadError('cancelled')

        const file = new File(download.uri)
        const failure = verifyDownload({
          expectedMd5: artifact.md5,
          expectedSizeBytes: artifact.sizeBytes,
          actualMd5: download.md5,
          actualSizeBytes: file.size,
        })
        if (failure) {
          file.delete()
          throw new UpdateDownloadError(failure)
        }

        return { fileUri: download.uri, contentUri: file.contentUri }
      })()

      return {
        result,
        cancel: () => {
          void resumable.cancelAsync().catch(() => {})
        },
      }
    },

    async install(downloaded) {
      // Both `data` and `type` on purpose: expo-intent-launcher calls
      // `setDataAndType` when it has both, and passing only the URI relies on
      // the file provider returning a MIME type for `.apk`, which many devices
      // do not.
      await IntentLauncher.startActivityAsync(ACTION_INSTALL_PACKAGE, {
        data: downloaded.contentUri,
        type: APK_MIME_TYPE,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      })
    },

    async openUnknownSourcesSettings() {
      const packageName = Application.applicationId
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
        data: packageName ? `package:${packageName}` : undefined,
      })
    },

    async openTestFlight(url) {
      // The https link needs no `LSApplicationQueriesSchemes` entry and lands
      // in the TestFlight app when it is installed, the App Store when it is
      // not. `itms-beta://` would need the Info.plist declaration.
      await Linking.openURL(url)
    },

    clearStaleDownloads() {
      try {
        const directory = updatesDirectory()
        if (directory.exists) directory.delete()
      } catch {
        // A cache we could not clear is not worth failing a launch over.
      }
    },
  }
}

let cached: UpdatePorts | null = null

/**
 * The process-wide ports instance.
 *
 * A singleton because `useUpdateCheck` keys effects on the ports object: a
 * fresh one per render would re-arm the AppState listener and re-run the check
 * on every commit.
 */
export function defaultUpdatePorts(): UpdatePorts {
  cached ??= createUpdatePorts()
  return cached
}
