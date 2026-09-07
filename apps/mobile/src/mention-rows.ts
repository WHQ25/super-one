import { BUILTIN_CAPABILITIES, isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { compareBuiltinMentionMatches, matchBuiltinMention } from '@superone/shared/mention-capability-match'
import { groupItems, type PopupGroup } from '@superone/shared/popup-groups'
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
  if (item.kind === 'builtin' || isBuiltinCapabilityId(item.kind)) return 'capability'
  if (item.kind === 'agent-profile') return 'agent-profile'
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

function capabilityRows(query: string, capabilityIds: unknown): MentionRow[] {
  const available = new Set(
    Array.isArray(capabilityIds) ? capabilityIds.filter(isBuiltinCapabilityId) : DEFAULT_CAPABILITIES,
  )
  const matches = BUILTIN_CAPABILITIES.flatMap((capability) => {
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
  const rows = [...capabilityRows(query, input.capabilityIds), ...agentProfileRows(query, input.agentProfiles)]
  const seen = new Set(rows.map((row) => `${row.item.kind}:${row.item.path}`))
  for (const item of input.remote) {
    const key = `${item.kind}:${item.path}`
    if (seen.has(key)) continue
    if (item.kind === 'desktop-app' && !hasQuery) continue
    seen.add(key)
    const display = mentionDisplayName(item)
    rows.push({
      item,
      labelIndices: remapIndices(item.path, display, item.matchIndices ?? []),
      keywordIndices: [],
      detail: item.description || item.path,
    })
  }
  return rows
}

export function groupMentionRows(rows: MentionRow[]): PopupGroup<MentionRow>[] {
  return groupItems(rows, (row) => mentionGroupKey(row.item), MENTION_GROUP_ORDER)
}
