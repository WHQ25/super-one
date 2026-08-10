/**
 * CLI view of managed harness release coupling. Implementation lives in
 * `@superone/runtime/harness`.
 *
 * Importing `./harness-host` installs the CLI release-version provider, so
 * `currentCliVersion()` resolves through `resolveCliReleaseVersion` here.
 */
import './harness-host'

export * from '@superone/runtime/harness/managed-release'
