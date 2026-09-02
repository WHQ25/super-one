import type { UpdateChannel } from './agent-types'

/**
 * Map a version string onto a release channel.
 *
 * The desktop app does NOT use this: stable and alpha are separate build
 * variants and each one knows its own identity (`variants.json`). This exists
 * for `@super-one/cli`, which ships at the desktop version but has no variant
 * of its own, and needs a harness manifest channel to download from.
 */
export function channelFromVersion(version: string): UpdateChannel {
  return /-alpha/i.test(version) ? 'alpha' : 'stable'
}
