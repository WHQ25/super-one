import type { UpdateChannel } from './agent-types'

/**
 * Map a version string onto a release channel.
 *
 * For callers with no variant of their own -- `@super-one/cli` ships at the
 * desktop version but is not one of the side-by-side apps, and still needs a
 * harness manifest channel to download from.
 *
 * The desktop app must NOT reach this: it knows its own identity from
 * `variants.json` and passes it explicitly. Deriving "which app am I" from
 * "what does my version string look like" only works while the builder asserts
 * the two agree, and that assertion is there to catch a mis-dispatched build.
 */
export function channelFromVersion(version: string): UpdateChannel {
  return /-alpha/i.test(version) ? 'alpha' : 'stable'
}
