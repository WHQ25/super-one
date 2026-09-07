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

/**
 * One mention row, in the desktop popup's shape.
 *
 * Every row there is a **single line** (`MentionPopup.tsx:919` —
 * `flex items-center`): an icon, the name, a quiet inline note beside it, and
 * at most a small badge at the end. The one exception is a switched-off
 * capability, which gets a second line saying where to switch it on.
 *
 * Mobile used to give every row a second line — the path under a filename, the
 * project under a session title, prose under a capability. That is a different
 * component wearing the same name, and it made the list twice as tall for
 * information the first line already carried.
 */
export interface MentionRow {
  item: MentionItem
  /** What the row shows, with the highlight over it. */
  label: string
  labelIndices: number[]
  /**
   * Quiet text right after the name: an `@handle`, or a project's path. Decided
   * here rather than in the renderer, which cannot know that a capability's
   * handle is its id while its description is prose — highlighting the prose
   * with indices scored against the id colours the wrong characters.
   */
  inline?: string
  inlineIndices: number[]
  /** Quiet text pushed to the end of the row — the project a session is in. */
  trailing?: string
  /** A small pill at the end: a model, a harness, or `Off`. */
  badge?: { text: string; tone: 'muted' | 'accent' }
  /** The only second line there is: where to switch a capability back on. */
  hint?: string
  /** Visible but not selectable. */
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

/**
 * What a file row shows: the path, minus the directory already typed.
 *
 * The desktop shows the whole relative path and drops only the scope prefix
 * (`MentionPopup.tsx:784`) — not the basename. Two files called `index.ts` are
 * otherwise indistinguishable, which is the case the path is there for.
 */
export function mentionDisplayName(item: MentionItem, scopeDir = ''): string {
  if (item.label) return item.label
  const path = item.path
  return scopeDir && path.startsWith(scopeDir) ? path.slice(scopeDir.length) : path
}

/**
 * Shift host match indices onto the string the row shows.
 *
 * The host scores the whole path and re-bases its indices onto it, so a scoped
 * row displaying `app.ts` out of `src/app.ts` has to subtract the same prefix
 * the display did. Indices that fall outside are dropped rather than drawn in
 * the wrong place.
 */
export function shiftIndices(indices: readonly number[], offset: number, length: number): number[] {
  if (!indices.length) return []
  if (!offset) return [...indices]
  return indices.map((index) => index - offset).filter((index) => index >= 0 && index < length)
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
  /** Directory prefix to drop from file paths, as the desktop does. */
  scopeDir?: string
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
}

/** Where a switched-off capability is switched back on. */
function capabilityHint(id: string): string {
  if (id === 'computer') return 'Enable Computer Use in the desktop settings'
  if (id === 'browser') return 'Enable Browser CDP in the desktop settings'
  return 'Enable it in the desktop settings'
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
        label: capability.displayName,
        labelIndices: scored.labelIndices,
        // A working capability shows its handle; a switched-off one shows why
        // instead, which is the one row that earns a second line. Filtering it
        // out entirely would make the feature look absent.
        ...(available.has(capability.id)
          ? { inline: `@${capability.id}`, inlineIndices: scored.keywordIndices }
          : { inlineIndices: [], disabled: true, hint: capabilityHint(capability.id),
              badge: { text: 'Off', tone: 'muted' as const } }),
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
        label: SESSION_PORTAL.displayName,
        labelIndices: portal.labelIndices,
        inline: `@${SESSION_PORTAL.id}`,
        inlineIndices: portal.keywordIndices,
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
        label,
        labelIndices: scored.labelIndices,
        // The provider ref used to sit under the name. The desktop shows the
        // slug beside it and nothing else — the ref is what gets inserted, not
        // something the user picks by.
        inline: `@${keyword}`,
        inlineIndices: scored.keywordIndices,
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
    rows.push(remoteRow(item, input.scopeDir ?? ''))
  }
  return rows
}

/**
 * A row for something the host produced, in the shape its kind takes on the
 * desktop: one line, with what distinguishes it pushed to the end.
 */
function remoteRow(item: MentionItem, scopeDir: string): MentionRow {
  const label = mentionDisplayName(item, scopeDir)
  const offset = item.label ? 0 : item.path.length - label.length
  const labelIndices = item.labelIndices ?? shiftIndices(item.matchIndices ?? [], offset, label.length)
  const row: MentionRow = { item, label, labelIndices, inlineIndices: [] }
  if (item.kind === 'session') {
    // Project on the left of the badge, harness on the right — both quiet, both
    // on the same line as the title.
    return { ...row, ...(item.description ? { trailing: item.description } : {}),
      ...(item.badge ? { badge: { text: item.badge, tone: 'muted' } } : {}) }
  }
  if (item.kind === 'session-project') {
    // `all projects` / `current project` / the path: the desktop shows it
    // inline, not underneath.
    return { ...row, ...(item.description ? { inline: item.description } : {}) }
  }
  if (item.kind === 'agent') {
    // `inherit` is what the desktop prints for an agent that names no model.
    return { ...row, badge: { text: item.badge || 'inherit', tone: 'muted' } }
  }
  if (item.kind === 'desktop-app') {
    return { ...row, badge: { text: 'Computer Use', tone: 'accent' } }
  }
  // Which checkout a multi-root hit came from goes where a session's project
  // goes — at the end of the same line, not under it.
  const root = item.rootPath?.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return root ? { ...row, trailing: root } : row
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

export function groupMentionRows(rows: MentionRow[]): PopupGroup<MentionRow>[] {
  return groupItems(rows, (row) => mentionGroupKey(row.item), MENTION_GROUP_ORDER)
}
