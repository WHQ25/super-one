/**
 * The `@git` grammar lives in `@superone/shared/git-mention-query` so the
 * mobile composer can reuse it. What stays here is the desktop's ref loader:
 * refs come through `window.app`, which a shared module must not know about.
 */
import {
  loadGitMentionRefsForKinds as loadGitMentionRefsForKindsWith,
  type GitMentionCapabilities,
  type GitMentionRefKind,
  type GitMentionRefsResult,
} from '@superone/shared/git-mention-query'

export {
  GIT_MENTION_NAV_PREFIX,
  GIT_MENTION_KEYWORD,
  GH_MENTION_NAV_PREFIX,
  GH_MENTION_KEYWORD,
  GIT_MENTION_REF_KINDS,
  GIT_MENTION_PORTALS,
  isGitMentionQuery,
  gitMentionPortalOfQuery,
  parseGitMentionQuery,
  listGitRefKindChoices,
  gitMentionSearchKinds,
  PLAIN_GIT_MENTION_KINDS,
  remainingGitArgumentHint,
  encodeGitMentionValue,
  parseGitMentionValue,
  gitMentionDisplayName,
  gitRefMatchIndices,
  isGitHubRefKind,
  type GitMentionCapabilities,
  type GitMentionPortal,
  type GitMentionRefKind,
  type GitMentionRef,
  type GitMentionRefsResult,
  type GitMentionRefsUnavailable,
  type ParsedGitMentionQuery,
} from '@superone/shared/git-mention-query'

export function loadGitMentionCapabilities(folderPath: string): Promise<GitMentionCapabilities> {
  return window.app.getGitMentionCapabilities(folderPath)
}

export function loadGitMentionRefs(
  folderPath: string,
  kind: GitMentionRefKind,
  query: string,
): Promise<GitMentionRefsResult> {
  return window.app.listGitMentionRefs(folderPath, kind, query)
}

/** Several kinds at once, in kind order, through the desktop ref IPC. */
export function loadGitMentionRefsForKinds(
  folderPath: string,
  kinds: readonly GitMentionRefKind[],
  query: string,
  options?: { perKindLimit?: number },
): Promise<GitMentionRefsResult> {
  return loadGitMentionRefsForKindsWith(
    kinds,
    query,
    (kind, refQuery) => loadGitMentionRefs(folderPath, kind, refQuery),
    options,
  )
}
