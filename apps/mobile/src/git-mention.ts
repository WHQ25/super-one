import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import {
  encodeGitMentionValue,
  gitMentionDisplayName,
  gitRefMatchIndices,
  isGitHubRefKind,
  shortSha,
  listGitRefKindChoices,
  parseGitMentionCapabilities,
  type GitMentionCapabilities,
  type GitMentionPortal,
  type GitMentionRef,
  type GitMentionRefKind,
  type GitMentionRefsResult,
  type ParsedGitMentionQuery,
} from '@superone/shared/git-mention-query'
import { formatRelativeTime } from '@superone/shared/relative-time'
import { randomId } from './ids'
import type { MentionItem } from './mentions'

export {
  isGitMentionQuery, parseGitMentionQuery, parseGitMentionValue,
  GIT_MENTION_KEYWORD, GIT_MENTION_NAV_PREFIX, GH_MENTION_KEYWORD, GH_MENTION_NAV_PREFIX,
  type GitMentionCapabilities, type GitMentionPortal, type GitMentionRefKind, type ParsedGitMentionQuery,
} from '@superone/shared/git-mention-query'

/** What the host lets `@git` / `@gh` do; absent on hosts that predate it. */
export function parseGitAvailability(raw: unknown): GitMentionCapabilities | undefined {
  return parseGitMentionCapabilities(raw) ?? undefined
}

export const GIT_KIND_LABELS: Record<GitMentionRefKind, string> = {
  branch: 'Branch', commit: 'Commit', worktree: 'Worktree', tag: 'Tag', issue: 'Issue', pr: 'Pull request',
}
const GIT_KIND_HINTS: Record<GitMentionRefKind, string> = {
  branch: 'local branches, current first',
  commit: 'recent history · search by message or sha',
  worktree: 'linked checkouts of this repository',
  tag: 'newest tags first',
  issue: 'by number or title',
  pr: 'by number or title',
}

/** Kind choices for the first phase; `path` is the kind, which is also the token. */
export function gitKindItems(portal: GitMentionPortal, kindToken: string): MentionItem[] {
  return listGitRefKindChoices(portal, kindToken).map((choice) => ({
    kind: 'git-kind',
    path: choice.kind,
    label: GIT_KIND_LABELS[choice.kind],
    description: `@${choice.kind} · ${GIT_KIND_HINTS[choice.kind]}`,
    labelIndices: [],
    navigateTo: `${portal} ${choice.kind} `,
  }))
}

/**
 * Ref rows in the desktop popup's shape: the exact identifier is the `path`
 * (what the chip carries), the label is what the row and chip show.
 */
export function gitRefItems(refs: readonly GitMentionRef[], query: string): MentionItem[] {
  return refs.map((ref) => {
    const indices = gitRefMatchIndices(ref, query)
    const when = ref.date ? formatRelativeTime(ref.date) : ''
    const commit = ref.kind === 'commit' && !!ref.detail.trim()
    const github = isGitHubRefKind(ref.kind) && !!ref.detail.trim()
    const trailing = commit || github
      ? [ref.author, when].filter(Boolean).join(' · ')
      : ref.kind === 'branch' && !ref.current ? when : ''
    // A commit is picked by its subject, so that is the label; the short sha
    // becomes the quiet handle beside it. An issue / PR reads as `#23 title`
    // in one run, the way GitHub writes it, with both parts highlightable.
    const numberPrefix = `${ref.label} `
    return {
      kind: 'git-ref',
      path: encodeGitMentionValue(ref.kind, ref.id, ref.host),
      label: commit ? ref.detail : gitMentionDisplayName(ref),
      description: commit ? shortSha(ref.id) : github ? '' : ref.detail,
      labelIndices: commit ? indices.detail
        : github ? [...indices.label, ...indices.detail.map((i) => i + numberPrefix.length)]
        : indices.label,
      descriptionIndices: commit ? indices.label : github ? [] : indices.detail,
      ...(ref.current ? { badge: 'current' } : ref.state ? { badge: ref.state } : {}),
      ...(trailing ? { rootPath: trailing } : {}),
    }
  })
}

export async function requestGitMentionRefs(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  kind: GitMentionRefKind,
  query: string,
): Promise<GitMentionRefsResult> {
  const result = await client.request({
    type: 'list_git_mention_refs', requestId: randomId(), projectPath, kind, query,
  } as RemoteCommand) as GitMentionRefsResult | { error?: string }
  if ('error' in result && result.error) throw new Error(result.error)
  return result as GitMentionRefsResult
}

export const GH_UNAVAILABLE_HINT = 'Needs the gh CLI signed in and a GitHub remote'

/** What "nothing here" means depends on which phase asked — the desktop's wording. */
export function gitEmptyLabel(parsed: ParsedGitMentionQuery, unavailable?: GitMentionRefsResult): string {
  if (unavailable && !unavailable.ok) {
    if (unavailable.reason === 'not-repo') return 'Not a git repository'
    if (unavailable.reason === 'unsupported') return 'Update the remote node to mention git refs'
    if (unavailable.reason === 'gh-unavailable') return GH_UNAVAILABLE_HINT
    return 'Could not read git refs'
  }
  if (parsed.phase === 'pick-kind') return 'No matching ref type'
  const kind = parsed.refKind ?? (parsed.portal === 'gh' ? 'issue' : 'branch')
  return `No matching ${kind === 'branch' ? 'branches' : kind === 'pr' ? 'pull requests' : `${kind}s`}`
}
