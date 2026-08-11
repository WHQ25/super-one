/**
 * Re-export shared managed layout from the harness kernel.
 * Implementation lives in `@superone/runtime/harness`.
 */
export {
  MANAGED_VERSIONS_DIRNAME,
  MANAGED_CURRENT_BASENAME,
  MANAGED_VERSION_KEEP,
  sanitizeRuntimeVersionForPath,
  managedVersionsDir,
  managedVersionDir,
  managedCurrentPath,
  readCurrentPointer,
  writeCurrentPointer,
  resolveActiveInstallRoot,
  pruneManagedVersions,
  type ManagedCurrentPointer,
} from '@superone/runtime/harness'
