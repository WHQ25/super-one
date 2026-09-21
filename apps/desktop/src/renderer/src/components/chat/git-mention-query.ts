/**
 * The `@git` grammar lives in `@superone/shared/git-mention-query` so the
 * mobile composer can reuse it. What stays here is the desktop's ref loader:
 * refs come through `window.app`, which a shared module must not know about.
 */
import type { GitMentionCapabilities, GitMentionRefKind, GitMentionRefsResult } from '@superone/shared/git-mention-query'

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
