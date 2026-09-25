/**
 * `@git` / `@gh` rows for the mention popup — the two built-in portals, the
 * ref-kind picker, and one ref row per branch / commit / worktree / tag /
 * issue / pull request. Kept out of `MentionPopup.tsx` so git mode reads as
 * one unit and the popup only branches on `isGitMode`.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { gitRefIcon, staticMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { cloneElement, type ReactElement } from 'react'
import { formatRelativeTime } from '@superone/shared/relative-time'
import {
  GH_MENTION_KEYWORD,
  GIT_MENTION_KEYWORD,
  isGitHubRefKind,
  type GitMentionPortal,
  type GitMentionRef,
  type GitMentionRefKind,
  type ParsedGitMentionQuery,
} from './git-mention-query'
import type { GitMentionAvailability } from './use-git-mention'
import { STACKED_BODY_CLASS, STACKED_DETAIL_CLASS, STACKED_ICON_CLASS, STACKED_ROW_CLASS } from './mention-row-layout'
import type { BuiltinMentionMatchRank } from './mention-capability-match'

export type GitFlatItem =
  | {
      /** Built-in "Git" / "GitHub" portal — Tab/Enter navigates into `@git ` / `@gh `. */
      kind: 'git-portal'
      id: GitMentionPortal
      displayName: string
      matchIndices: number[]
      keywordMatchIndices: number[]
      matchRank: BuiltinMentionMatchRank
      /** Why the row cannot be entered; undefined when it can. */
      disabledReason?: Exclude<GitMentionAvailability, 'ready' | 'unknown'> | 'gh-unavailable'
    }
  | {
      /** branch | commit | worktree | tag | issue | pr — Tab completes into the query. */
      kind: 'git-kind'
      portal: GitMentionPortal
      refKind: GitMentionRefKind
      matchIndices: number[]
    }
  | {
      kind: 'git-ref'
      ref: GitMentionRef
      /** Highlight over `ref.label`. */
      matchIndices: number[]
      /** Highlight over `ref.detail` (a commit subject can be what matched). */
      detailMatchIndices: number[]
    }

export function isGitFlatItem(item: { kind: string }): item is GitFlatItem {
  return item.kind === 'git-portal' || item.kind === 'git-kind' || item.kind === 'git-ref'
}

export function gitMentionGroupKey(item: GitFlatItem): string {
  if (item.kind === 'git-portal') return 'capability'
  if (item.kind === 'git-kind') return 'git-kind'
  return `git-${item.ref.kind}`
}

export const GIT_MENTION_GROUP_ORDER = ['git-kind', 'git-branch', 'git-commit', 'git-worktree', 'git-tag', 'git-issue', 'git-pr'] as const

const KIND_LABEL_KEY: Record<GitMentionRefKind, string> = {
  branch: 'chat.mentionPopup.gitKindBranch',
  commit: 'chat.mentionPopup.gitKindCommit',
  worktree: 'chat.mentionPopup.gitKindWorktree',
  tag: 'chat.mentionPopup.gitKindTag',
  issue: 'chat.mentionPopup.gitKindIssue',
  pr: 'chat.mentionPopup.gitKindPr',
}
const KIND_HINT_KEY: Record<GitMentionRefKind, string> = {
  branch: 'chat.mentionPopup.gitKindBranchHint',
  commit: 'chat.mentionPopup.gitKindCommitHint',
  worktree: 'chat.mentionPopup.gitKindWorktreeHint',
  tag: 'chat.mentionPopup.gitKindTagHint',
  issue: 'chat.mentionPopup.gitKindIssueHint',
  pr: 'chat.mentionPopup.gitKindPrHint',
}
const GROUP_LABEL_KEY: Record<string, string> = {
  'git-kind': 'chat.mentionPopup.groupGitKinds',
  'git-branch': 'chat.mentionPopup.groupGitBranches',
  'git-commit': 'chat.mentionPopup.groupGitCommits',
  'git-worktree': 'chat.mentionPopup.groupGitWorktrees',
  'git-tag': 'chat.mentionPopup.groupGitTags',
  'git-issue': 'chat.mentionPopup.groupGitIssues',
  'git-pr': 'chat.mentionPopup.groupGitPrs',
}
const EMPTY_KEY: Record<GitMentionRefKind, string> = {
  branch: 'chat.mentionPopup.noGitBranches',
  commit: 'chat.mentionPopup.noGitCommits',
  worktree: 'chat.mentionPopup.noGitWorktrees',
  tag: 'chat.mentionPopup.noGitTags',
  issue: 'chat.mentionPopup.noGitIssues',
  pr: 'chat.mentionPopup.noGitPrs',
}
const STATE_KEY: Record<NonNullable<GitMentionRef['state']>, string> = {
  open: 'chat.mentionPopup.gitStateOpen',
  closed: 'chat.mentionPopup.gitStateClosed',
  merged: 'chat.mentionPopup.gitStateMerged',
  draft: 'chat.mentionPopup.gitStateDraft',
}
const PORTAL_LABEL_KEY: Record<GitMentionPortal, string> = {
  git: 'chat.mentionPopup.capabilityGit',
  gh: 'chat.mentionPopup.capabilityGh',
}
/** The kind an empty portal query is about, for copy that needs one. */
const PORTAL_DEFAULT_KIND: Record<GitMentionPortal, GitMentionRefKind> = { git: 'branch', gh: 'issue' }

/** The mark for a portal as a whole: the branch glyph for `@git`, GitHub's own for `@gh`. */
function portalIcon(portal: GitMentionPortal, className: string) {
  if (portal === 'git') return gitRefIcon('branch', className)
  const icon = staticMentionIcon('github') as ReactElement<{ className?: string }>
  return cloneElement(icon, { className })
}

/** One place for “can this portal be entered?” copy, shared by the row and the empty state. */
function disabledHintKey(reason: NonNullable<Extract<GitFlatItem, { kind: 'git-portal' }>['disabledReason']>): string {
  if (reason === 'not-repo') return 'chat.mentionPopup.gitNotRepoHint'
  if (reason === 'gh-unavailable') return 'chat.mentionPopup.ghUnavailableHint'
  return 'chat.mentionPopup.gitUnsupportedHint'
}

function statePillClass(state: NonNullable<GitMentionRef['state']>): string {
  if (state === 'open') return 'bg-success/15 text-success'
  if (state === 'merged') return 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
  return 'bg-muted/60 text-muted-foreground'
}

function stateIconClass(state: GitMentionRef['state']): string {
  if (state === 'open') return 'text-success'
  if (state === 'merged') return 'text-violet-600 dark:text-violet-400'
  return 'text-muted-foreground'
}

export function gitMentionGroupLabelKey(groupKey: string): string | null {
  return GROUP_LABEL_KEY[groupKey] ?? null
}

export function gitPortalLabelKey(portal: GitMentionPortal): string {
  return PORTAL_LABEL_KEY[portal]
}

interface RowProps {
  index: number
  selected: boolean
  setItemRef: (el: HTMLButtonElement | null) => void
  onHover: () => void
}

function rowClass(selected: boolean): string {
  return cn(
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
    selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/40',
  )
}

function HighlightedHandle({ keyword, indices }: { keyword: string; indices: number[] }) {
  const shifted = indices.length > 0 ? [0, ...indices.map((i) => i + 1)] : indices
  return <HighlightedText text={`@${keyword}`} indices={shifted} className="truncate" />
}

export function GitPortalRow({
  item,
  onNavigate,
  index,
  selected,
  setItemRef,
  onHover,
}: RowProps & { item: Extract<GitFlatItem, { kind: 'git-portal' }>; onNavigate: () => void }) {
  const { t } = useTranslation()
  const disabled = item.disabledReason !== undefined
  return (
    <button
      key={`c-${item.id}-portal`}
      ref={setItemRef}
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { if (!disabled) onNavigate() }}
      onMouseEnter={onHover}
      className={cn(
        rowClass(selected),
        disabled && 'cursor-not-allowed opacity-55 hover:bg-transparent data-[disabled]:pointer-events-auto',
      )}
      data-index={index}
      // The reason stays one hover away; the row itself reads like every other built-in.
      title={item.disabledReason !== undefined ? t(disabledHintKey(item.disabledReason)) : undefined}
    >
      {portalIcon(item.id, cn('size-3.5 shrink-0', disabled ? 'text-muted-foreground' : 'text-foreground'))}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          <HighlightedText text={item.displayName} indices={item.matchIndices} className="truncate" />
        </span>
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          <HighlightedHandle keyword={item.id} indices={item.keywordMatchIndices} />
        </span>
      </span>
      <span className="shrink-0 text-2xs text-muted-foreground">
        {disabled ? (
          <span className="rounded bg-muted px-1 py-px">{t('chat.mentionPopup.disabled')}</span>
        ) : (
          <Kbd>tab</Kbd>
        )}
      </span>
    </button>
  )
}

export function GitKindRow({
  item,
  onNavigate,
  selected,
  setItemRef,
  onHover,
}: RowProps & { item: Extract<GitFlatItem, { kind: 'git-kind' }>; onNavigate: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      ref={setItemRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onNavigate}
      onMouseEnter={onHover}
      className={rowClass(selected)}
    >
      {gitRefIcon(item.refKind, 'size-3.5 shrink-0 text-foreground')}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          <HighlightedText text={t(KIND_LABEL_KEY[item.refKind])} indices={[]} className="truncate" />
        </span>
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          {/* The full token, as typed: `@gh issue`, not a `@issue` that does not exist. */}
          <HighlightedHandle
            keyword={`${item.portal} ${item.refKind}`}
            indices={item.matchIndices.map((i) => i + item.portal.length + 1)}
          />
        </span>
        <span className="ml-1.5 text-2xs font-normal text-muted-foreground/80">
          {t(KIND_HINT_KEY[item.refKind])}
        </span>
      </span>
      <span className="shrink-0 text-2xs text-muted-foreground">
        <Kbd>tab</Kbd>
      </span>
    </button>
  )
}

export function GitRefRow({
  item,
  onSelect,
  selected,
  setItemRef,
  onHover,
}: RowProps & { item: Extract<GitFlatItem, { kind: 'git-ref' }>; onSelect: () => void }) {
  const { t } = useTranslation()
  const { ref } = item
  const when = ref.date ? formatRelativeTime(ref.date) : ''
  if (isGitHubRefKind(ref.kind)) {
    // GitHub's own list shape: title line, then `#n` · author · age underneath,
    // with the state pill at the row's end. The icon takes the state colour too.
    return (
      <button
        ref={setItemRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        onMouseEnter={onHover}
        className={cn(rowClass(selected), 'items-start')}
        title={ref.detail}
      >
        {gitRefIcon(ref.kind, cn('mt-0.5 size-3.5 shrink-0', stateIconClass(ref.state)))}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 truncate font-medium">
            <HighlightedText text={ref.detail || ref.label} indices={item.detailMatchIndices} className="truncate" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="shrink-0 font-mono">
              <HighlightedText text={ref.label} indices={item.matchIndices} />
            </span>
            {ref.author || when ? <span className="shrink-0 text-muted-foreground/60">·</span> : null}
            {ref.author ? <span className="truncate">{ref.author}</span> : null}
            {ref.author && when ? <span className="shrink-0 text-muted-foreground/60">·</span> : null}
            {when ? <span className="shrink-0">{when}</span> : null}
            {ref.state ? (
              <span className={cn('ml-auto shrink-0 rounded px-1 py-px', statePillClass(ref.state))}>
                {t(STATE_KEY[ref.state])}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    )
  }
  const commit = ref.kind === 'commit' && !!ref.detail
  const meta = [ref.author, when].filter(Boolean).join(' · ')
  return (
    <button
      ref={setItemRef}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(rowClass(selected), STACKED_ROW_CLASS)}
      title={ref.kind === 'commit' ? ref.id : ref.detail}
    >
      {gitRefIcon(ref.kind, cn('size-3.5 shrink-0 text-foreground', STACKED_ICON_CLASS))}
      {commit ? (
        // Subject is what a commit is picked by; the sha is the quiet handle
        // that must survive a long subject's truncation.
        <span className={STACKED_BODY_CLASS}>
          <span className="min-w-0 truncate font-medium @md:flex-1">
            <HighlightedText text={ref.detail} indices={item.detailMatchIndices} className="truncate" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground @md:shrink-0 @md:gap-2">
            <span className="shrink-0 font-mono">
              <HighlightedText text={ref.label} indices={item.matchIndices} />
            </span>
            {meta ? <span className="shrink-0 text-muted-foreground/60 @md:hidden">·</span> : null}
            {meta ? <span className="truncate @md:max-w-28">{meta}</span> : null}
          </span>
        </span>
      ) : (
        // The name keeps the room; a subject, path or tag message follows it.
        <span className={STACKED_BODY_CLASS}>
          <span className={cn('min-w-0 truncate font-medium @md:max-w-full @md:shrink-0', ref.kind === 'commit' && 'font-mono')}>
            <HighlightedText text={ref.label} indices={item.matchIndices} className="truncate" />
          </span>
          {ref.detail ? (
            <span className={cn(STACKED_DETAIL_CLASS, '@md:flex-1')}>
              <HighlightedText text={ref.detail} indices={item.detailMatchIndices} className="truncate" />
            </span>
          ) : null}
        </span>
      )}
      {ref.current ? (
        <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-2xs text-muted-foreground">
          {t('chat.mentionPopup.gitCurrent')}
        </span>
      ) : null}
      {ref.kind === 'commit' && !commit && meta ? (
        <span className="max-w-28 shrink-0 truncate text-2xs text-muted-foreground">{meta}</span>
      ) : ref.kind === 'branch' && when && !ref.current ? (
        <span className="shrink-0 text-2xs text-muted-foreground">{when}</span>
      ) : null}
    </button>
  )
}

/** Breadcrumb strip at the top of the popup while in `@git` / `@gh` mode. */
export function GitMentionHeader({
  parsed,
  onNavigate,
}: {
  parsed: ParsedGitMentionQuery
  onNavigate: (prefix: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-1.5 border-b border-border/50 px-2 py-1.5 text-xs">
      {parsed.refKind
        ? gitRefIcon(parsed.refKind, 'size-3.5 shrink-0 text-foreground')
        : portalIcon(parsed.portal, 'size-3.5 shrink-0 text-foreground')}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onNavigate(`${parsed.portal} `)}
          className="shrink-0 font-medium text-foreground hover:underline"
        >
          {t(PORTAL_LABEL_KEY[parsed.portal])}
        </button>
        <span className="shrink-0 text-muted-foreground/50">/</span>
        {parsed.refKind ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onNavigate(parsed.kindNavPrefix ?? `${parsed.portal} `)}
            className="shrink-0 font-medium text-foreground/90 hover:underline"
          >
            {t(KIND_LABEL_KEY[parsed.refKind])}
          </button>
        ) : (
          <span className="truncate text-muted-foreground">{t('chat.mentionPopup.gitPickKind')}</span>
        )}
        {parsed.phase === 'need-query' ? (
          <>
            <span className="shrink-0 text-muted-foreground/50">/</span>
            <span className="truncate text-muted-foreground">
              {t(parsed.portal === 'gh' ? 'chat.mentionPopup.ghNeedQueryShort' : 'chat.mentionPopup.gitNeedQueryShort')}
            </span>
          </>
        ) : null}
        {parsed.refQuery ? (
          <>
            <span className="shrink-0 text-muted-foreground/50">/</span>
            <span className="min-w-0 max-w-48 truncate text-muted-foreground" title={parsed.refQuery}>
              “{parsed.refQuery}”
            </span>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** Empty / error copy for git mode; null when the list has rows or is loading. */
export function GitMentionEmpty({
  parsed,
  itemCount,
  loading,
  unavailable,
}: {
  parsed: ParsedGitMentionQuery
  itemCount: number
  loading: boolean
  unavailable: string | null
}): ReactNode {
  const { t } = useTranslation()
  if (itemCount > 0 || loading) return null
  if (parsed.phase === 'pick-kind' && !unavailable) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">{t('chat.mentionPopup.noGitKinds')}</div>
  }
  const message =
    unavailable === 'not-repo' || unavailable === 'unsupported' || unavailable === 'gh-unavailable'
      ? t(disabledHintKey(unavailable))
      : unavailable
        ? t('chat.mentionPopup.gitLoadError')
        : t(EMPTY_KEY[parsed.refKind ?? PORTAL_DEFAULT_KIND[parsed.portal]])
  return (
    <div className="space-y-1 px-2 py-3 text-xs text-muted-foreground">
      <div className="font-medium text-foreground/80">{message}</div>
      {parsed.phase === 'need-query' && !unavailable ? (
        <div className="font-mono text-xs text-muted-foreground">
          @{parsed.portal === 'gh' ? GH_MENTION_KEYWORD : GIT_MENTION_KEYWORD} {parsed.refKind}{' '}
          {parsed.portal === 'gh' ? '<number | query>' : '<query>'}
        </div>
      ) : null}
    </div>
  )
}

export function GitMentionFooter({ parsed }: { parsed: ParsedGitMentionQuery }) {
  const { t } = useTranslation()
  if (parsed.phase === 'pick-kind') {
    return (
      <>
        <Kbd>tab</Kbd> {t('chat.mentionPopup.hintCompleteGitKind')}
        <span className="mx-1.5">&middot;</span>
        <Kbd>↑↓</Kbd> navigate
        <span className="mx-1.5">&middot;</span>
        <Kbd>esc</Kbd> close
      </>
    )
  }
  return (
    <>
      <Kbd>↵</Kbd> {t('chat.mentionPopup.hintSelectGitRef')}
      <span className="mx-1.5">&middot;</span>
      {parsed.phase === 'need-query' ? t('chat.mentionPopup.hintTypeGitQuery') : <><Kbd>↑↓</Kbd> navigate</>}
      <span className="mx-1.5">&middot;</span>
      <Kbd>esc</Kbd> close
    </>
  )
}
