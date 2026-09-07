import { BUILTIN_CAPABILITIES, isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { compareBuiltinMentionMatches, matchBuiltinMention } from '@superone/shared/mention-capability-match'
import { groupItems, type PopupGroup } from '@superone/shared/popup-groups'
import { SESSION_MENTION_KEYWORD, SESSION_MENTION_NAV_PREFIX } from '@superone/shared/session-mention-query'
import type { MentionItem } from './mentions'

/**
 * Desktop's group order, adopted verbatim so `@` puts the same thing in the
 * same place on both surfaces.
 *
 * Mobile used to merge agent profiles with project agents, and mini-apps with
 * desktop apps. They are different things — a launchable collaborator is not a
 * project agent — and merging them also meant the two orders could never agree.
 *
 * `groupItems` drops any key missing from this list **silently**, so a new
 * mention kind must be mapped in `mentionGroupKey` and listed here, or its rows
 * simply stop appearing.
 */
export const MENTION_GROUP_ORDER = [
  'capability',
  'agent-profile',
  'session-project',
  'session',
  'desktop-app',
  'agent',
  'miniapp',
  'file',
] as const

export type MentionGroupKey = typeof MENTION_GROUP_ORDER[number]

export const MENTION_GROUP_LABELS: Record<MentionGroupKey, string> = {
  capability: 'Built-in',
  'agent-profile': 'Collaborators',
  'session-project': 'Project scope',
  session: 'Sessions',
  'desktop-app': 'Desktop Apps',
  agent: 'Agents',
  miniapp: 'Mini apps',
  file: 'Files',
}

export interface MentionRow {
  item: MentionItem
  /** Highlight over the row's display name. */
  labelIndices: number[]
  /**
   * The `@keyword` a built-in row shows beside its name, and the highlight over
   * it. Decided here rather than derived in the renderer: a capability's keyword
   * is its id while its description is prose, and highlighting the prose with
   * indices scored against the id colours the wrong characters.
   */
  keyword?: string
  keywordIndices: number[]
  /** The row's second line. */
  detail: string
  /** Visible but not selectable: the capability is switched off on the desktop. */
  disabled?: boolean
}

export function mentionGroupKey(item: MentionItem): MentionGroupKey {
  // The session portal is a built-in the user reaches the same way, so it
  // belongs in the same group and the same ranking.
  if (item.kind === 'builtin' || item.kind === 'session-portal' || isBuiltinCapabilityId(item.kind)) return 'capability'
  if (item.kind === 'agent-profile') return 'agent-profile'
  if (item.kind === 'session-project') return 'session-project'
  if (item.kind === 'session') return 'session'
  if (item.kind === 'desktop-app') return 'desktop-app'
  if (item.kind === 'agent') return 'agent'
  if (item.kind === 'miniapp') return 'miniapp'
  return 'file'
}

/** What the row actually renders — a label if the host gave one, else the leaf. */
export function mentionDisplayName(item: MentionItem): string {
  return item.label || item.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || item.path
}

/**
 * Move host match indices from the path they were computed over onto the
 * shorter string the row displays.
 *
 * The host scores whole paths; a row shows a basename. Forwarding the indices
 * unchanged would highlight the wrong characters — off by the length of the
 * directory prefix — which is worse than not highlighting at all.
 */
export function remapIndices(path: string, display: string, indices: readonly number[]): number[] {
  if (!indices.length) return []
  if (display === path) return [...indices]
  const offset = path.lastIndexOf(display)
  if (offset < 0) return []
  return indices.map((index) => index - offset).filter((index) => index >= 0 && index < display.length)
}

export interface MentionRowInput {
  /** Rows the host produced: files, project agents, mini-apps, desktop apps. */
  remote: MentionItem[]
  /** Launchable provider identities, from the host's collaboration registry. */
  agentProfiles: MentionItem[]
  /** Capability ids the desktop currently has switched on. */
  capabilityIds?: unknown
  /**
   * The query is anchored — to a directory (`@src/app`) or to the session
   * portal (`@session all …`) — so only the producer's own rows apply. A
   * capability that happens to match the last segment would be answering a
   * question the user did not ask.
   */
  scoped?: boolean
}

const DEFAULT_CAPABILITIES = ['widget', 'debug']

/**
 * Rank within a group, never across groups.
 *
 * `@co` preferring Codex is a fact about the collaborators group, not about the
 * whole list — capabilities still come first. And an empty query keeps catalog
 * order, so bare `@` is not silently re-sorted by a tie-breaker.
 */
function rankBuiltins<T extends { row: MentionRow; keyword: string; rank: 0 | 1 | 2 }>(
  matches: T[],
  query: string,
): MentionRow[] {
  if (query.trim()) {
    matches.sort((a, b) =>
      compareBuiltinMentionMatches({ rank: a.rank, keyword: a.keyword }, { rank: b.rank, keyword: b.keyword }))
  }
  return matches.map((match) => match.row)
}

/**
 * The `@session` portal, ranked among the capabilities rather than beside them.
 *
 * It is not a capability — selecting it navigates instead of inserting a tag —
 * but it is discovered the same way, so hiding it in its own group would make
 * it findable only by people who already know it exists.
 */
const SESSION_PORTAL = {
  id: SESSION_MENTION_KEYWORD,
  displayName: 'Session',
  intent: 'mention an earlier session by project and title',
}

function capabilityRows(query: string, capabilityIds: unknown): MentionRow[] {
  const available = new Set(
    Array.isArray(capabilityIds) ? capabilityIds.filter(isBuiltinCapabilityId) : DEFAULT_CAPABILITIES,
  )
  // Typed up front: the portal joins this list and its keyword is not one of
  // the capability ids.
  const matches: { keyword: string; rank: 0 | 1 | 2; row: MentionRow }[] = BUILTIN_CAPABILITIES.flatMap((capability) => {
    const scored = matchBuiltinMention(capability.id, [capability.displayName], query)
    if (!scored) return []
    return [{
      keyword: capability.id,
      rank: scored.rank,
      row: {
        item: {
          kind: 'builtin',
          path: capability.id,
          label: capability.displayName,
          description: capability.intent,
        } as MentionItem,
        labelIndices: scored.labelIndices,
        keyword: `@${capability.id}`,
        keywordIndices: scored.keywordIndices,
        detail: capability.intent,
        // Kept visible rather than filtered out: a capability that exists but is
        // switched off is worth knowing about, and hiding it makes the feature
        // look absent.
        ...(available.has(capability.id) ? {} : { disabled: true }),
      },
    }]
  })
  const portal = matchBuiltinMention(SESSION_PORTAL.id, [SESSION_PORTAL.displayName], query)
  if (portal) {
    matches.push({
      keyword: SESSION_PORTAL.id,
      rank: portal.rank,
      row: {
        item: {
          kind: 'session-portal',
          path: SESSION_PORTAL.id,
          label: SESSION_PORTAL.displayName,
          navigateTo: SESSION_MENTION_NAV_PREFIX,
        } as MentionItem,
        labelIndices: portal.labelIndices,
        keyword: `@${SESSION_PORTAL.id}`,
        keywordIndices: portal.keywordIndices,
        detail: SESSION_PORTAL.intent,
      },
    })
  }
  return rankBuiltins(matches, query)
}

function agentProfileRows(query: string, profiles: MentionItem[]): MentionRow[] {
  const matches = profiles.flatMap((item) => {
    const keyword = (item.description ?? '').replace(/^@/, '') || item.path
    const label = mentionDisplayName(item)
    // Slug first, so `@co` prefers Codex. An alias matches but never
    // highlights — highlighting a string the row does not show is a lie.
    let scored = matchBuiltinMention(keyword, [label], query)
    if (!scored) {
      for (const alias of item.aliases ?? []) {
        const aliasMatch = matchBuiltinMention(alias, [label], query)
        if (aliasMatch) { scored = { ...aliasMatch, keywordIndices: [] }; break }
      }
    }
    if (!scored) return []
    return [{
      keyword,
      rank: scored.rank,
      row: {
        item,
        labelIndices: scored.labelIndices,
        keyword: `@${keyword}`,
        keywordIndices: scored.keywordIndices,
        // The slug is already on the first line; repeating it below would be
        // the same string twice.
        detail: item.path,
      },
    }]
  })
  return rankBuiltins(matches, query)
}

/**
 * Build every row the `@` overlay can show, ranked and de-duplicated.
 *
 * Desktop apps need a query. Bare `@` on the desktop shows capabilities and
 * files, not the twelve applications the host happens to return first; matching
 * that keeps the empty state readable.
 */
export function buildMentionRows(query: string, input: MentionRowInput): MentionRow[] {
  const hasQuery = !!query.trim()
  const rows = input.scoped
    ? []
    : [...capabilityRows(query, input.capabilityIds), ...agentProfileRows(query, input.agentProfiles)]
  const seen = new Set(rows.map((row) => mentionRowKey(row.item)))
  for (const item of input.remote) {
    const key = mentionRowKey(item)
    if (seen.has(key)) continue
    if (item.kind === 'desktop-app' && !hasQuery) continue
    seen.add(key)
    const display = mentionDisplayName(item)
    rows.push({
      item,
      labelIndices: item.labelIndices ?? remapIndices(item.path, display, item.matchIndices ?? []),
      keywordIndices: [],
      // A browse row needs no second line: every row in a listing shares the
      // same directory, and the breadcrumb above already names it. Elsewhere the
      // path is worth showing unless it is the name again.
      detail: rowDetail(item, display),
    })
  }
  return rows
}

/**
 * Identity of a row, for de-duplication and for React.
 *
 * The path alone is not it: with additional directories in scope, two roots can
 * each hold `src/index.ts`, and keying on the path would silently drop one of
 * two genuinely different files.
 */
export function mentionRowKey(item: MentionItem): string {
  return `${item.kind}:${item.rootPath ? `${item.rootPath}\0` : ''}${item.path}`
}

function rowDetail(item: MentionItem, display: string): string {
  if (item.description) return item.description
  // A browse row needs no second line: every row in a listing shares the same
  // directory, and the breadcrumb above already names it.
  if (item.kind === 'dir-entry') return ''
  const path = display === item.path ? '' : item.path
  // Which checkout a multi-root hit came from is the only thing telling two
  // same-named files apart, so it leads the line.
  const root = item.rootPath?.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return root ? `${root} · ${path || display}` : path
}

export function groupMentionRows(rows: MentionRow[]): PopupGroup<MentionRow>[] {
  return groupItems(rows, (row) => mentionGroupKey(row.item), MENTION_GROUP_ORDER)
}
