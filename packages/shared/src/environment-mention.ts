/**
 * Environment mention chips shared by desktop and phone.
 *
 * Two ways in:
 *   @env
 *   @env <name>
 *   @<name>
 *
 * `@env` opens the catalog. Typing `@` and a machine's own name matches that
 * row directly, including a name that contains a space. The catalog is this
 * machine, remote CLI nodes, and other SuperOne desktops this computer can
 * control. Paired phones are not rows. A chip value is `<role>:<id>`.
 *
 * Everything here is pure. Listing machines is host work.
 */

import { fuzzyMatch } from './fuzzy-match'
import { compareMentionMatchKeys, mentionMatchKey } from './mention-match-tier'

/** Portal keyword after `@`. `@env` owns the catalog; `@env <name>` filters it. */
export const ENVIRONMENT_MENTION_KEYWORD = 'env'

/** Navigate prefix when the user opens the catalog. */
export const ENVIRONMENT_MENTION_NAV_PREFIX = 'env '

/** Ghost argument hint while `@env` has no name yet. */
export const ENVIRONMENT_MENTION_ARGUMENT_HINT = '<name>'

export type EnvironmentMentionRole = 'local' | 'cli-node' | 'remote-desktop'

export type EnvironmentMentionStatus = 'connected' | 'connecting' | 'offline' | 'needs-upgrade'

export interface EnvironmentMentionSource {
  kind: 'local' | 'remote'
  environmentId: string
  label: string
  installationProfile?: string | null
  state: string
  desired?: boolean
  nodeUpgrade?: unknown
}

export interface EnvironmentMentionCandidate {
  role: EnvironmentMentionRole
  id: string
  label: string
  status: EnvironmentMentionStatus
}

export interface EnvironmentMentionRow extends EnvironmentMentionCandidate {
  matchIndices: number[]
}

const ROLES = new Set<EnvironmentMentionRole>(['local', 'cli-node', 'remote-desktop'])

export const ENVIRONMENT_TAG_REGEX =
  /<superone-environment>\s*<name>([\s\S]*?)<\/name>\s*<role>(local|cli-node|remote-desktop)<\/role>\s*<id>([\s\S]*?)<\/id>\s*<\/superone-environment>/g

export const ENVIRONMENT_REMINDER_REGEX =
  /\n*<superone-environment-reminder>[\s\S]*?<\/superone-environment-reminder>\n*/g

/** True when the @-query is inside `@env` (`env` or `env …`). `@environment` is not this. */
export function isEnvironmentMentionQuery(query: string): boolean {
  return new RegExp(`^${ENVIRONMENT_MENTION_KEYWORD}(?:\\s|$)`, 'i').test(query)
}

/** Name filter after `@env`, or null when this is not the catalog. */
export function parseEnvironmentMentionQuery(query: string): { nameQuery: string } | null {
  if (!isEnvironmentMentionQuery(query)) return null
  return { nameQuery: query.slice(ENVIRONMENT_MENTION_KEYWORD.length).trim() }
}

/** Remaining ghost hint. Hidden once a name is being typed. */
export function remainingEnvironmentArgumentHint(queryAfterAt: string): string | null {
  const parsed = parseEnvironmentMentionQuery(queryAfterAt)
  if (!parsed || parsed.nameQuery) return null
  return ENVIRONMENT_MENTION_ARGUMENT_HINT
}

/**
 * A name such as `Mac mini` needs its space when typed directly after `@`.
 * The popup stays open only while the typed text is still a prefix of one of
 * these labels, so the next word of the sentence closes it.
 */
export function environmentMentionAllowsSpaces(query: string, labels: readonly string[]): boolean {
  if (!query.includes(' ') || isEnvironmentMentionQuery(query)) return false
  const typed = query.toLowerCase()
  return labels.some((label) => label.toLowerCase().startsWith(typed))
}

/**
 * Same connection reading the sidebar uses: an explicit disconnect stays
 * offline, and a live node that needs an upgrade says so.
 */
export function environmentMentionStatus(item: Pick<EnvironmentMentionSource, 'state' | 'desired' | 'nodeUpgrade'>): EnvironmentMentionStatus {
  if (item.desired === false) return 'offline'
  if (item.state === 'offline' || item.state === 'disconnected' || item.state === 'blocked') return 'offline'
  const live = item.state === 'connected' || item.state === 'synchronizing'
  if (item.nodeUpgrade && live) return 'needs-upgrade'
  if (live) return 'connected'
  return 'connecting'
}

function roleOf(item: EnvironmentMentionSource): EnvironmentMentionRole | null {
  if (item.kind === 'local') return 'local'
  if (item.kind !== 'remote') return null
  return item.installationProfile === 'local-electron' ? 'remote-desktop' : 'cli-node'
}

function cleanId(id: string): string | null {
  const trimmed = id.trim()
  if (!trimmed || trimmed.length > 512 || /[<>]/.test(trimmed)) return null
  return trimmed
}

/** Chip value. Null when the id cannot survive the stored tag. */
export function encodeEnvironmentMentionValue(role: EnvironmentMentionRole, id: string): string | null {
  const clean = cleanId(id)
  if (!clean || !ROLES.has(role)) return null
  return `${role}:${clean}`
}

export function parseEnvironmentMentionValue(value: string): { role: EnvironmentMentionRole; id: string } | null {
  const match = /^(local|cli-node|remote-desktop):([\s\S]+)$/.exec(value)
  if (!match) return null
  const role = match[1] as EnvironmentMentionRole
  const id = cleanId(match[2])
  if (!id) return null
  return { role, id }
}

/**
 * This machine first, then remote nodes, then other desktops.
 * Phones are not mention targets. Within a role, a live machine comes first.
 */
export function buildEnvironmentMentionCandidates(input: {
  environments: readonly EnvironmentMentionSource[]
}): EnvironmentMentionCandidate[] {
  const machines: EnvironmentMentionCandidate[] = []
  for (const item of input.environments) {
    const role = roleOf(item)
    if (!role) continue
    const id = cleanId(item.environmentId)
    if (!id) continue
    const label = item.label.trim() || id
    machines.push({ role, id, label, status: environmentMentionStatus(item) })
  }
  const roleRank = (role: EnvironmentMentionRole) => role === 'local' ? 0 : role === 'cli-node' ? 1 : 2
  const statusRank = (status: EnvironmentMentionStatus) => status === 'connected' ? 0 : status === 'connecting' ? 1 : status === 'needs-upgrade' ? 2 : 3
  machines.sort((a, b) =>
    roleRank(a.role) - roleRank(b.role) || statusRank(a.status) - statusRank(b.status) || a.label.localeCompare(b.label))
  return machines
}

/** Filter and rank a catalog by a typed name (`@env <name>` or `@<name>`). */
export function filterEnvironmentMentions(
  candidates: readonly EnvironmentMentionCandidate[],
  nameQuery: string,
): EnvironmentMentionRow[] {
  const query = nameQuery.trim()
  const rows = candidates.flatMap((candidate): EnvironmentMentionRow[] => {
    const matched = query ? fuzzyMatch(query, candidate.label) : null
    if (matched && !matched.match) return []
    return [{ ...candidate, matchIndices: matched?.indices ?? [] }]
  })
  if (!query) return rows
  rows.sort((a, b) => {
    const cmp = compareMentionMatchKeys(mentionMatchKey(a.label, query), mentionMatchKey(b.label, query))
    return cmp !== 0 ? cmp : a.label.localeCompare(b.label)
  })
  return rows
}

/** Stored user-message tag. Invalid values stay plain `@name` text. */
export function wrapEnvironmentMention(displayName: string, value: string): string {
  const parsed = parseEnvironmentMentionValue(value)
  if (!parsed) return `@${displayName || value}`
  return `<superone-environment><name>${displayName}</name><role>${parsed.role}</role><id>${parsed.id}</id></superone-environment>`
}

/**
 * Agent-only reminder. Every row is an execution environment.
 * The local machine is already the current one, so its id is not passed.
 */
export function formatEnvironmentMentionReminder(
  mentions: readonly { value: string; displayName?: string }[],
): string {
  const seen = new Set<string>()
  const local: string[] = []
  const remote: string[] = []
  for (const mention of mentions) {
    const parsed = parseEnvironmentMentionValue(mention.value)
    if (!parsed || seen.has(mention.value)) continue
    seen.add(mention.value)
    const name = mention.displayName?.trim() || parsed.id
    if (parsed.role === 'local') local.push(`- "${name}"`)
    else remote.push(`- "${name}" (environmentId: ${parsed.id})`)
  }
  if (local.length === 0 && remote.length === 0) return ''
  const lines = [
    'User @-mentioned an environment. Use these ids; never invent them.',
    '',
  ]
  if (local.length > 0) {
    lines.push(
      'This machine. Omit environmentId; the session is already here.',
      ...local,
    )
  }
  if (remote.length > 0) {
    if (local.length > 0) lines.push('')
    lines.push(
      'Other machines. Pass environmentId to session_collab_request (environment field, spawn only) and to environment-scoped tools such as session_list and session_search. Read read_manual({ domain: "product", topic: "collaboration" }) before the first launch in a session.',
      ...remote,
    )
  }
  return `\n\n<superone-environment-reminder>\n${lines.join('\n')}\n</superone-environment-reminder>`
}
