/**
 * Wire format for `@git` / `@gh` mentions — the structured tag the composer
 * writes. It is self-describing for the agent (kind and exact identifier), so
 * no reminder block is appended on send. Repository refs and hosted items are
 * different tags: the outer element names the forge, so a future
 * `<superone-gitlab>` needs no change to the shape.
 *
 *   <superone-git><kind>commit</kind><name>f14bf73</name><id>f14bf73f…</id></superone-git>
 *   <superone-github><kind>issue</kind><name>#23 Crash</name><id>23</id></superone-github>
 */

import {
  GIT_HOST_PROVIDERS,
  encodeGitMentionValue,
  isGitHostProvider,
  parseGitMentionValue,
} from './git-mention-query'

const INNER = '\\s*<kind>([\\s\\S]*?)<\\/kind>\\s*<name>([\\s\\S]*?)<\\/name>\\s*<id>([\\s\\S]*?)<\\/id>\\s*'

function escapeGitTagText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeGitTagText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Repository refs: groups are kind, name, id. */
export const GIT_TAG_REGEX = new RegExp(`<superone-git>${INNER}<\\/superone-git>`, 'g')

/** Hosted items: groups are host (from the element name), kind, name, id. */
export const GIT_HOST_TAG_REGEX = new RegExp(
  `<superone-(${GIT_HOST_PROVIDERS.join('|')})>${INNER}<\\/superone-\\1>`,
  'g',
)

/** `value` is the chip value; a malformed one is written as text, never as a tag. */
export function wrapGitMention(value: string, displayName: string): string {
  const parsed = parseGitMentionValue(value)
  if (!parsed) return `@${displayName.trim() || value}`
  const name = displayName.trim() || parsed.id
  const tag = parsed.host ? `superone-${parsed.host}` : 'superone-git'
  return `<${tag}><kind>${escapeGitTagText(parsed.kind)}</kind><name>${escapeGitTagText(name)}</name><id>${escapeGitTagText(parsed.id)}</id></${tag}>`
}

/** Chip value recovered from a tag match; null when the kind (or host) is unknown. */
export function gitTagValue(kind: string, id: string, host?: string): string | null {
  const parsed = parseGitMentionValue(
    host
      ? `${unescapeGitTagText(kind).trim()}:${host.trim()}:${unescapeGitTagText(id).trim()}`
      : `${unescapeGitTagText(kind).trim()}:${unescapeGitTagText(id).trim()}`,
  )
  if (!parsed) return null
  if (host !== undefined && !isGitHostProvider(host.trim())) return null
  return encodeGitMentionValue(parsed.kind, parsed.id, parsed.host)
}

export function gitTagDisplayName(name: string): string {
  return unescapeGitTagText(name).trim()
}

/** User-visible collapse: `@main`, `@f14bf73`, `@#23 Crash`. */
export function replaceGitTagsWithMention(text: string): string {
  return text
    .replace(GIT_TAG_REGEX, (_full, _kind, name) => `@${gitTagDisplayName(String(name))}`)
    .replace(GIT_HOST_TAG_REGEX, (_full, _host, _kind, name) => `@${gitTagDisplayName(String(name))}`)
}
