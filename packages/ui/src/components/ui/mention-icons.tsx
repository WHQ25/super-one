import { cloneElement, type ReactElement } from 'react'
import { Bot, Bug, CircleDot, FolderGit2, Folder, GitBranch, GitCommitHorizontal, GitPullRequest, Globe, LayoutDashboard, MessageSquare, MousePointer2, Tag, Users } from 'lucide-react'
import { parseGitMentionValue, type GitMentionRefKind } from '@superone/shared/git-mention-query'
import { GithubIcon } from './github-icon'

/**
 * Static mention identities shared by desktop chips and the mobile transcript.
 * `value` is only consulted for kinds whose icon depends on it (`git`).
 *
 * Every `if (kind === '…') return <Icon className="…" />` line here is read by
 * `apps/mobile/scripts/mention-glyphs.ts` to render native chip artwork — keep
 * the literal shape, including the `git:<ref kind>` pseudo-kinds.
 */
export function staticMentionIcon(kind: string, value?: string) {
  if (kind === 'agent') return <Bot className="text-purple-600 dark:text-purple-400" />
  if (kind === 'directory') return <Folder className="text-blue-600 dark:text-blue-400" />
  if (kind === 'session') return <MessageSquare className="text-foreground" />
  if (kind === 'git') return staticMentionIcon(gitGlyphKind(parseGitMentionValue(value ?? '')?.kind ?? 'branch'))
  // Git refs stay neutral like sessions; the coloured hues are capability identities.
  if (kind === 'git:branch') return <GitBranch className="text-foreground" />
  if (kind === 'git:commit') return <GitCommitHorizontal className="text-foreground" />
  if (kind === 'git:worktree') return <FolderGit2 className="text-foreground" />
  if (kind === 'git:tag') return <Tag className="text-foreground" />
  if (kind === 'git:issue') return <CircleDot className="text-foreground" />
  if (kind === 'git:pr') return <GitPullRequest className="text-foreground" />
  // The `@gh` portal as a whole (its rows keep the issue / PR glyphs above).
  if (kind === 'github') return <GithubIcon className="text-foreground" />
  if (kind === 'collab') return <Users className="text-violet-600 dark:text-violet-400" />
  // Match Settings / ComputerUseToolBlock branding (pointer, not monitor).
  if (kind === 'computer') return <MousePointer2 className="text-emerald-600 dark:text-emerald-400" />
  if (kind === 'browser') return <Globe className="text-sky-600 dark:text-sky-400" />
  if (kind === 'widget') return <LayoutDashboard className="text-amber-600 dark:text-amber-400" />
  if (kind === 'debug') return <Bug className="text-rose-600 dark:text-rose-400" />
  return null
}

/** Glyph key for one git ref kind (`git:branch` …) — what the mobile artwork is indexed by. */
export function gitGlyphKind(kind: GitMentionRefKind): `git:${GitMentionRefKind}` {
  return `git:${kind}`
}

/** The git ref icon with a caller-chosen class (popup rows need sizing). */
export function gitRefIcon(kind: GitMentionRefKind, className = 'text-foreground') {
  const icon = staticMentionIcon(gitGlyphKind(kind)) as ReactElement<{ className?: string }>
  return cloneElement(icon, { className })
}
