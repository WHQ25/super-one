import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Eye,
  FolderClosed,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  RefreshCw,
  Rows2,
  Sparkles,
  WrapText,
} from 'lucide-react'
import type {
  ReviewCommitInfo,
  ReviewRepoInfo,
  ReviewScope,
  ReviewTurnDiff,
  ReviewWorkspaceMode,
} from '@superone/shared/review-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { LspStatusPill } from '@/components/coding/LspStatusPill'

export type DiffStylePreference = 'auto' | 'split' | 'unified'

interface ReviewToolbarProps {
  scope: ReviewScope
  onScopeChange: (scope: ReviewScope) => void
  workspaceMode: ReviewWorkspaceMode
  selectedCommitSha: string | null
  onSelectWorkspaceMode: (mode: ReviewWorkspaceMode, commitSha?: string) => void
  repos: readonly ReviewRepoInfo[]
  selectedRepoPath: string | null
  currentBranch: string | null
  baseBranch: string | null
  recentCommits: readonly ReviewCommitInfo[]
  onSelectRepo: (repoPath: string) => void
  hasFiles: boolean
  sidebarVisible: boolean
  onToggleSidebar: () => void
  turns: readonly ReviewTurnDiff[]
  selectedTurnIndex: number | null
  onSelectTurn: (turnIndex: number) => void
  fileCount: number
  additions: number
  deletions: number
  showConcurrentBadge: boolean
  showToolFallbackBadge: boolean
  diffPref: DiffStylePreference
  onDiffPrefChange: (pref: DiffStylePreference) => void
  allCollapsed: boolean
  onToggleCollapseAll: () => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  richPreview: boolean
  onToggleRichPreview: () => void
  loading: boolean
  onRefresh: () => void
  lspWorkspaceRoot?: string | null
  lspFilePaths?: readonly string[]
  lspAllowed?: boolean
}

const DIFF_PREF_ORDER: readonly DiffStylePreference[] = ['auto', 'split', 'unified']

export function ReviewToolbar({
  scope,
  onScopeChange,
  workspaceMode,
  selectedCommitSha,
  onSelectWorkspaceMode,
  repos,
  selectedRepoPath,
  currentBranch,
  baseBranch,
  recentCommits,
  onSelectRepo,
  hasFiles,
  sidebarVisible,
  onToggleSidebar,
  turns,
  selectedTurnIndex,
  onSelectTurn,
  fileCount,
  additions,
  deletions,
  showConcurrentBadge,
  showToolFallbackBadge,
  diffPref,
  onDiffPrefChange,
  allCollapsed,
  onToggleCollapseAll,
  wordWrap,
  onToggleWordWrap,
  richPreview,
  onToggleRichPreview,
  loading,
  onRefresh,
  lspWorkspaceRoot,
  lspFilePaths,
  lspAllowed = false,
}: ReviewToolbarProps) {
  const { t } = useTranslation()
  const activeTurn = turns.find((turn) => turn.turnIndex === selectedTurnIndex)
  const activeRepo = repos.find((r) => r.path === selectedRepoPath) ?? repos.find((r) => r.isMain) ?? repos[0]
  const activeCommit = recentCommits.find((c) => c.sha === selectedCommitSha)

  const repoLabel = activeRepo
    ? (repos.length > 1
        ? (activeRepo.branch ? `${activeRepo.name} (${activeRepo.branch})` : activeRepo.name)
        : (activeRepo.branch || activeRepo.name))
    : currentBranch

  const scopeLabel = (() => {
    if (scope === 'turn') {
      return activeTurn ? `${t('review.scopes.turn')} #${activeTurn.turnIndex}` : t('review.scopes.turn')
    }
    if (scope === 'session') return t('review.scopes.session')
    if (workspaceMode === 'commit') {
      return activeCommit ? activeCommit.shortSha : (selectedCommitSha?.slice(0, 7) || t('review.scopes.committed'))
    }
    if (workspaceMode === 'branch' && baseBranch) {
      return `${baseBranch}...HEAD`
    }
    return t(`review.scopes.${workspaceMode}`)
  })()

  const nextDiffPref = DIFF_PREF_ORDER[(DIFF_PREF_ORDER.indexOf(diffPref) + 1) % DIFF_PREF_ORDER.length]

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {hasFiles && (
          <IconButton
            size="sm"
            variant="ghost"
            aria-pressed={sidebarVisible}
            className={cn(sidebarVisible ? 'text-primary' : 'text-muted-foreground')}
            tooltip={t('review.layout.toggleFiles')}
            onClick={onToggleSidebar}
          >
            <FolderClosed />
          </IconButton>
        )}

        {repoLabel && (
          repos.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 max-w-44 items-center gap-1 rounded-md bg-muted/40 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus:outline-none"
                >
                  <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{repoLabel}</span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                {repos.map((repo) => {
                  const selected = activeRepo?.path === repo.path
                  return (
                    <DropdownMenuItem
                      key={repo.path}
                      onClick={() => onSelectRepo(repo.path)}
                      className="gap-2 text-xs"
                    >
                      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        {repo.name}
                        {repo.branch && (
                          <span className="ml-1.5 text-muted-foreground">({repo.branch})</span>
                        )}
                      </span>
                      {selected && <Check className="size-3.5 shrink-0" />}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="inline-flex h-7 items-center gap-1 rounded-md bg-muted/30 px-2 text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="max-w-32 truncate">{repoLabel}</span>
            </span>
          )
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted/40 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus:outline-none"
            >
              <span>{scopeLabel}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {turns.length > 1 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2 text-xs">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  <span className="flex-1">{t('review.scopes.turn')}</span>
                  {scope === 'turn' && <Check className="size-3.5" />}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-w-72">
                  {turns.map((turn) => (
                    <DropdownMenuItem
                      key={turn.turnIndex}
                      onClick={() => {
                        onScopeChange('turn')
                        onSelectTurn(turn.turnIndex)
                      }}
                      className="gap-2 text-xs"
                    >
                      <span className="flex-1 truncate">
                        #{turn.turnIndex} · {turn.promptPreview || t('review.turnLabel', { index: turn.turnIndex })}
                      </span>
                      {scope === 'turn' && selectedTurnIndex === turn.turnIndex && (
                        <Check className="size-3.5 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem onClick={() => onScopeChange('turn')} className="gap-2 text-xs">
                <Sparkles className="size-3.5 text-muted-foreground" />
                <span className="flex-1">{t('review.scopes.turn')}</span>
                {scope === 'turn' && <Check className="size-3.5" />}
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={() => onScopeChange('session')} className="gap-2 text-xs">
              <Layers className="size-3.5 text-muted-foreground" />
              <span className="flex-1">{t('review.scopes.session')}</span>
              {scope === 'session' && <Check className="size-3.5" />}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {(['uncommitted', 'unstaged', 'staged'] as const).map((mode) => (
              <DropdownMenuItem
                key={mode}
                onClick={() => {
                  onScopeChange('workspace')
                  onSelectWorkspaceMode(mode)
                }}
                className="gap-2 text-xs"
              >
                <span className="flex-1">{t(`review.scopes.${mode}`)}</span>
                {scope === 'workspace' && workspaceMode === mode && (
                  <Check className="size-3.5 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {recentCommits.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2 text-xs">
                  <GitCommitHorizontal className="size-3.5 text-muted-foreground" />
                  <span className="flex-1">{t('review.scopes.committed')}</span>
                  {scope === 'workspace' && workspaceMode === 'commit' && (
                    <Check className="size-3.5 shrink-0" />
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 max-w-80 overflow-y-auto">
                  {recentCommits.map((commit) => (
                    <DropdownMenuItem
                      key={commit.sha}
                      onClick={() => {
                        onScopeChange('workspace')
                        onSelectWorkspaceMode('commit', commit.sha)
                      }}
                      className="gap-2 text-xs"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {commit.shortSha}
                      </span>
                      <span className="flex-1 truncate">{commit.subject}</span>
                      {scope === 'workspace' && workspaceMode === 'commit' && selectedCommitSha === commit.sha && (
                        <Check className="size-3.5 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {baseBranch && (
              <DropdownMenuItem
                onClick={() => {
                  onScopeChange('workspace')
                  onSelectWorkspaceMode('branch')
                }}
                className="gap-2 text-xs"
              >
                <GitBranch className="size-3.5 text-muted-foreground" />
                <span className="flex-1">
                  {t('review.scopes.branch')}
                  <span className="ml-1.5 text-muted-foreground">({baseBranch})</span>
                </span>
                {scope === 'workspace' && workspaceMode === 'branch' && (
                  <Check className="size-3.5 shrink-0" />
                )}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <span>
            {fileCount === 1
              ? t('review.filesCountOne')
              : t('review.filesCount', { count: fileCount })}
          </span>
          {additions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
          )}
          {deletions > 0 && (
            <span className="text-rose-600 dark:text-rose-400">-{deletions}</span>
          )}
        </div>

        {showConcurrentBadge && (
          <span
            className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
            title={t('review.badges.concurrent')}
          >
            <AlertTriangle className="size-3" />
            {t('review.badges.concurrent')}
          </span>
        )}

        {showToolFallbackBadge && (
          <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('review.badges.toolFallback')}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <LspStatusPill
          workspaceRoot={lspWorkspaceRoot}
          filePaths={lspFilePaths}
          variant="review"
          enabled={lspAllowed && Boolean(lspFilePaths?.length)}
          className="h-7 px-2 text-xs"
        />
        <IconButton
          size="sm"
          variant="ghost"
          className={cn(
            diffPref === 'auto' ? 'w-auto px-1.5 text-muted-foreground' : 'text-primary',
          )}
          tooltip={t(`review.layout.${diffPref}`)}
          onClick={() => onDiffPrefChange(nextDiffPref)}
        >
          {diffPref === 'split' ? (
            <Columns2 />
          ) : diffPref === 'unified' ? (
            <Rows2 />
          ) : (
            <span className="text-[11px] font-medium leading-none">{t('review.layout.autoLabel')}</span>
          )}
        </IconButton>

        {hasFiles && (
          <IconButton
            size="sm"
            variant="ghost"
            tooltip={allCollapsed ? t('review.actions.expandAll') : t('review.actions.collapseAll')}
            onClick={onToggleCollapseAll}
          >
            {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
          </IconButton>
        )}

        <IconButton
          size="sm"
          variant="ghost"
          aria-pressed={richPreview}
          className={cn(richPreview ? 'text-primary' : 'text-muted-foreground')}
          tooltip={t('review.actions.richPreview')}
          onClick={onToggleRichPreview}
        >
          <Eye />
        </IconButton>

        <IconButton
          size="sm"
          variant="ghost"
          aria-pressed={wordWrap}
          className={cn(wordWrap ? 'text-primary' : 'text-muted-foreground')}
          tooltip={t('review.actions.wordWrap')}
          onClick={onToggleWordWrap}
        >
          <WrapText />
        </IconButton>

        <IconButton
          size="sm"
          variant="ghost"
          tooltip={t('review.actions.refresh')}
          onClick={onRefresh}
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  )
}
