import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronRight, GitCompareArrows, Loader2, RefreshCw } from 'lucide-react'
import type { GitPatchRequest, GitPatchResult } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { DiffView, buildUnifiedFileChangeDiffLines } from '@/lib/diff-utils'
import { splitPatchFiles, type PatchFile } from '@/lib/git-patch-files'

/** Beyond this many files every section starts folded, so the list itself is the overview. */
const EXPANDED_FILE_LIMIT = 8

export type GitPatchLoader = (root: string, request: GitPatchRequest) => Promise<GitPatchResult>

export interface DiffPanelProps {
  /** Folder the change set is read from (a session's working directory). */
  root: string
  commit?: string
  path?: string
  /** Injected by stories; the app reads through the preload git bridge. */
  load?: GitPatchLoader
}

type LoadState = { status: 'loading' } | { status: 'done'; result: GitPatchResult }

const defaultLoad: GitPatchLoader = (root, request) => window.app.getGitPatch(root, request)

/** Read-only view of one change set: uncommitted work or a single commit, optionally one file. */
export function DiffPanel({ root, commit, path, load = defaultLoad }: DiffPanelProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    load(root, { ...(commit ? { commit } : {}), ...(path ? { path } : {}) })
      .then((result) => { if (!cancelled) setState({ status: 'done', result }) })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'done', result: { ok: false, error: 'failed', message: err instanceof Error ? err.message : String(err) } })
      })
    return () => { cancelled = true }
  }, [root, commit, path, load, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  const result = state.status === 'done' ? state.result : null
  const files = useMemo(() => (result?.ok ? splitPatchFiles(result.patch) : []), [result])
  const title = result?.ok && result.commit
    ? t('activity.diff.commit', { sha: result.commit.sha.slice(0, 7) })
    : commit ? t('activity.diff.commit', { sha: commit.slice(0, 7) }) : t('activity.diff.uncommitted')
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-medium">{title}</span>
            {result?.ok && result.commit?.subject && (
              <span className="truncate text-xs text-muted-foreground">{result.commit.subject}</span>
            )}
          </div>
          {(path || files.length > 0) && (
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {path && <span className="truncate font-mono">{path}</span>}
              {files.length > 0 && <span className="shrink-0">{t('activity.diff.fileCount', { count: files.length })}</span>}
              {files.length > 0 && <ChangeCounts additions={additions} deletions={deletions} />}
            </div>
          )}
        </div>
        <IconButton size="sm" variant="ghost" tooltip={t('activity.diff.refresh')} aria-label={t('activity.diff.refresh')} onClick={refresh} disabled={state.status === 'loading'}>
          <RefreshCw className={cn(state.status === 'loading' && 'animate-spin')} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.status === 'loading' && <Notice icon={<Loader2 className="size-5 animate-spin" />} text={t('activity.diff.loading')} />}
        {result && !result.ok && (
          <Notice
            icon={<AlertTriangle className="size-5 text-warning" />}
            text={t(`activity.diff.error.${result.error}`)}
            detail={result.message}
            action={result.error === 'failed' ? <Button size="sm" variant="outline" onClick={refresh}>{t('activity.diff.retry')}</Button> : undefined}
          />
        )}
        {result?.ok && files.length === 0 && (
          <Notice icon={<GitCompareArrows className="size-5 text-muted-foreground/50" />} text={t(commit ? 'activity.diff.emptyCommit' : 'activity.diff.empty')} />
        )}
        {files.length > 0 && (
          <div className="flex flex-col">
            {files.map((file) => (
              <PatchFileSection key={`${file.oldPath ?? ''}:${file.path}`} file={file} defaultOpen={files.length <= EXPANDED_FILE_LIMIT} />
            ))}
          </div>
        )}
        {result?.ok && result.omittedUntracked?.length ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t('activity.diff.omittedUntracked', { count: result.omittedUntracked.length, files: result.omittedUntracked.join(', ') })}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ChangeCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 font-mono tabular-nums">
      <span className="text-green-600 dark:text-green-400">+{additions}</span>
      {' '}
      <span className="text-red-600 dark:text-red-400">−{deletions}</span>
    </span>
  )
}

function Notice({ icon, text, detail, action }: { icon: React.ReactNode; text: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{text}</p>
      {detail && <p className="max-w-md break-words font-mono text-[11px] text-muted-foreground/80">{detail}</p>}
      {action}
    </div>
  )
}

function PatchFileSection({ file, defaultOpen }: { file: PatchFile; defaultOpen: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const lines = useMemo(() => (open ? buildUnifiedFileChangeDiffLines(file.diff) : []), [open, file.diff])
  const name = file.path.split('/').pop() ?? file.path
  return (
    <section className="border-b border-border/60">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/40"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <FileIcon name={name} size={14} className="shrink-0" />
        <span className="min-w-0 truncate font-mono" title={file.path}>{file.path}</span>
        {file.status !== 'modified' && (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{t(`activity.diff.status.${file.status}`)}</span>
        )}
        <span className="ml-auto" />
        <ChangeCounts additions={file.additions} deletions={file.deletions} />
      </button>
      {open && (
        <div className="pb-2">
          {file.oldPath && <p className="px-9 pb-1 text-[11px] text-muted-foreground">{t('activity.diff.renamedFrom', { path: file.oldPath })}</p>}
          {file.binary
            ? <p className="px-9 pb-1 text-[11px] text-muted-foreground">{t('activity.diff.binary')}</p>
            : lines.length > 0 && (
              <DiffView lines={lines} maxHeight="max-h-[560px]" className="bg-transparent text-xs [--diff-gutter-bg:var(--card)]" />
            )}
        </div>
      )}
    </section>
  )
}
