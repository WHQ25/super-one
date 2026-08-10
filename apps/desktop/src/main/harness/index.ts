/**
 * Desktop harness host — kernel wiring, tarball installer, spawn-time gate.
 *
 * See docs/design/harness-hot-swap.md §5 / §7 P2.
 */

export { resolveHarnessHomeRoot } from './home'
export {
  createDesktopTarballInstaller,
  resolveDesktopManagedBinary,
  desktopPackagePins,
  codexPlatformVersion,
  resolveNpmPackMeta,
  verifyNpmIntegrity,
  extractTgzWithSystemTar,
} from './tarball-installer'
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
} from './service'
export type { EnableHarnessInput, HarnessInstallationStatus, NodeHarnessId } from './service'
export {
  resolveHarnessRuntime,
  tryResolveHarnessRuntime,
  HarnessNotReadyError,
  isHarnessNotReadyError,
} from './resolve-runtime'
