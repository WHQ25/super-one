/**
 * Desktop harness host — kernel wiring, tarball installer, spawn-time gate.
 *
 * See docs/design/harness-hot-swap.md §5 / §7 P2.
 */

export { resolveHarnessHomeRoot } from './home'
export {
  managedVersionDir,
  managedVersionsDir,
  managedCurrentPath,
  readCurrentPointer,
  writeCurrentPointer,
  resolveActiveInstallRoot,
  pruneManagedVersions,
  sanitizeRuntimeVersionForPath,
  MANAGED_VERSION_KEEP,
  MANAGED_CURRENT_BASENAME,
} from './managed-layout'
export {
  createDesktopTarballInstaller,
  resolveDesktopManagedBinary,
  resolveDesktopManagedBinaryInRoot,
  desktopPackagePins,
  codexPlatformVersion,
  resolveNpmPackMeta,
  verifyNpmIntegrity,
  verifySha256,
  sha256Hex,
  resolveHarnessManifestChannel,
  extractTgzArchive,
  createThrottledProgress,
  createDownloadToFile,
  downloadResumableToFile,
  streamResponseToFile,
  hashExistingFile,
  parseContentRange,
  harnessDownloadDir,
  harnessArtifactDownloadKey,
  harnessPartialPath,
  resetDestPathLocksForTests,
  HARNESS_PROGRESS_THROTTLE_MS,
  readRuntimeVersion,
} from './tarball-installer'
export type { HttpFetch, DownloadToFileResult, StreamToFileOptions } from './tarball-installer'
export {
  desktopHarnessDeps,
  desktopHarnessResolver,
  desktopHarnessAuthProbe,
} from './host'
export {
  getHarnessManager,
  resetHarnessManagerForTests,
  listHarnessInstallations,
  getHarnessInstallation,
  enableDesktopHarness,
  disableDesktopHarness,
  probeDesktopHarness,
  ensureManagedHarnessReady,
  alignEnabledManagedHarnesses,
  enabledManagedHarnessesNeedAlign,
  prefetchEnabledHarnessesForAppUpdate,
  setHarnessInstallProgressListener,
} from './service'
export type {
  EnableHarnessInput,
  HarnessInstallationStatus,
  NodeHarnessId,
  HarnessInstallProgressEvent,
} from './service'
export { registerHarnessIpcHandlers } from './ipc'
export {
  resolveHarnessRuntime,
  tryResolveHarnessRuntime,
  HarnessNotReadyError,
  isHarnessNotReadyError,
} from './resolve-runtime'
export {
  HARNESS_RESOURCES_CACHE_TTL_MS,
  getFreshHarnessResources,
  connectWithHarnessResourceCache,
} from './resource-cache'
export type { FreshHarnessResourcesHit } from './resource-cache'
