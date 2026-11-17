import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { ArrowLeft, ArrowLeftRight, Check, ChevronDown, ChevronRight, Download, GitBranch, GitPullRequest, Globe, Loader2, RefreshCw } from 'lucide-react'
import type {
  BranchImportResult,
  BranchRelation,
  CheckoutFromSourceRequest,
  CheckoutProgress,
  CheckoutProgressPhase,
  CheckoutSource,
  CheckoutSourceBranch,
  CheckoutSourceBranchesResult,
  GitDirtyStatus,
} from '@superone/shared/agent-types'
import { formatBytes } from '@superone/shared/format-bytes'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { formatCompactAge } from '@superone/shared/relative-time'
import { useScrollEdgeFade } from '@superone/ui/lib/use-scroll-edge-fade'
import { EnvironmentKindIcon } from '@/components/sidebar/multi-host/EnvironmentKindIcon'
import { DiffStat } from './DiffStat'
import type { CheckoutSourceGroup, CheckoutSourceOption } from './checkout-sources'

const rowClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:shadow-none'

/** Same spring as the workdir tab body, so the popover grows with the action. */
const ACTION_PANEL_SPRING = { type: 'spring', bounce: 0.15, duration: 0.3 } as const
const buttonClass = 'flex items-center justify-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50'
const primaryClass = 'flex items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50'

function SourceIcon({ option, className = 'size-3 shrink-0' }: { option: CheckoutSourceOption; className?: string }) {
  if (option.group === 'node') {
    return <EnvironmentKindIcon kind={option.hostKind ?? 'cli-node'} path={option.path} connection={option.disabled === 'offline' ? 'offline' : undefined} className={className} />
  }
  if (option.group === 'remote') return <Globe className={className} aria-hidden />
  return <GitPullRequest className={className} aria-hidden />
}

/** The source name with its icon, as the inline control that opens the source menu. */
function SourceChip({ option, onClick, expanded }: { option: CheckoutSourceOption; onClick: () => void; expanded: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={(event) => { event.stopPropagation(); onClick() }}
      className="mx-0.5 inline-flex max-w-32 items-center gap-1 rounded-full border px-1.5 py-px align-middle hover:bg-background"
    >
      <SourceIcon option={option} />
      <span className="truncate">{option.label}</span>
      <ChevronDown className="size-2.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

const GROUP_LABEL: Record<CheckoutSourceGroup, string> = {
  node: 'chat.git.sourceGroupNodes',
  remote: 'chat.git.sourceGroupRemotes',
  pr: 'chat.git.sourceGroupGitHub',
}

const DISABLED_LABEL: Record<NonNullable<CheckoutSourceOption['disabled']>, string> = {
  offline: 'chat.git.sourceOffline',
  'needs-upgrade': 'chat.git.sourceNeedsUpgrade',
  'gh-unavailable': 'chat.git.sourceGhUnavailable',
}

/** Every source, grouped; unavailable ones say why. */
export function CheckoutSourceMenu({ options, selectedId, onSelect }: {
  options: CheckoutSourceOption[]
  selectedId: string | null
  onSelect: (option: CheckoutSourceOption) => void
}) {
  const { t } = useTranslation()
  const groups = (['node', 'remote', 'pr'] as const).filter((group) => options.some((option) => option.group === group))
  return (
    <div role="menu" className="border-t bg-muted/40 pb-1">
      {groups.map((group) => (
        <div key={group}>
          <div className="px-3 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">{t(GROUP_LABEL[group])}</div>
          {options.filter((option) => option.group === group).map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              disabled={!!option.disabled}
              onClick={() => onSelect(option)}
              className={`${rowClass} disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent`}
            >
              <SourceIcon option={option} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{option.label}</span>
                {(option.disabled || option.detail) && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {option.disabled ? t(DISABLED_LABEL[option.disabled]) : option.detail}
                  </span>
                )}
              </span>
              {option.id === selectedId && <Check className="size-3 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Branch-list footer: "Check Out Branch from <source>", the source chip opening the menu. */
export function CheckoutSourceFooter({ options, selected, onOpen }: {
  options: CheckoutSourceOption[]
  selected: CheckoutSourceOption
  onOpen: (option: CheckoutSourceOption) => void
}) {
  const [menu, setMenu] = useState(false)
  return (
    <>
      <div role="button" tabIndex={0} className={`${rowClass} cursor-pointer`} onClick={() => onOpen(selected)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(selected) } }}>
        <Download className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <Trans i18nKey="chat.git.sourceCheckoutFrom" components={{ source: <SourceChip option={selected} expanded={menu} onClick={() => setMenu((open) => !open)} /> }} />
        </span>
      </div>
      {menu && <CheckoutSourceMenu options={options} selectedId={selected.id} onSelect={(option) => { setMenu(false); onOpen(option) }} />}
    </>
  )
}

const RELATION_STYLE: Record<BranchRelation, string> = {
  new: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  behind: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  update: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  diverged: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  ahead: 'text-muted-foreground',
  same: 'text-muted-foreground',
}

const RELATION_LABEL: Record<BranchRelation, string> = {
  new: 'chat.git.relationNew',
  behind: 'chat.git.relationBehind',
  update: 'chat.git.relationUpdate',
  diverged: 'chat.git.relationDiverged',
  ahead: 'chat.git.relationAhead',
  same: 'chat.git.relationSame',
}

/**
 * How the other environment's tip stands against the same branch name.
 * Stored `behind` means that branch is behind the tip, so the other side is ahead.
 */
function syncStatusText(branch: CheckoutSourceBranch, t: TFunction): string {
  switch (branch.relation) {
    case 'behind':
      return branch.behind
        ? t('chat.git.syncStatusAheadCount', { count: branch.behind })
        : t('chat.git.syncStatusAhead')
    case 'ahead':
      return branch.ahead
        ? t('chat.git.syncStatusBehindCount', { count: branch.ahead })
        : t('chat.git.syncStatusBehind')
    case 'new':
      return t('chat.git.syncStatusNew')
    case 'diverged':
      return t('chat.git.syncStatusDiverged')
    case 'update':
    case 'same':
      return t('chat.git.syncStatusUpdate')
  }
}

export function RelationPill({ relation, behind, children }: { relation: BranchRelation; behind?: number; children?: ReactNode }) {
  const { t } = useTranslation()
  const label = relation === 'behind' && !behind ? t('chat.git.relationUpdate') : t(RELATION_LABEL[relation], { count: behind })
  return (
    <span className={`inline-flex max-w-32 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[11px] ${RELATION_STYLE[relation]}`}>
      <span>{label}</span>
      {children}
    </span>
  )
}

type Failure = Extract<BranchImportResult, { ok: false }>
const ERROR_KEY: Record<Exclude<Failure['reason'], 'diverged' | 'cancelled'>, string> = {
  unsupported: 'chat.git.sourceUnsupported',
  detached: 'chat.git.sourceErrorDetached',
  'no-commits': 'chat.git.sourceErrorNoCommits',
  exists: 'chat.git.sourceErrorExists',
  conflict: 'chat.git.sourceErrorConflict',
  error: 'chat.git.sourceErrorGeneric',
}

export interface LandedBranch {
  branch: string
  /** Switch the checkout to `branch`; the parent owns that flow and its failure dialog. */
  checkout: boolean
}

/**
 * Run one checkout-source import and report it: a success toast unless the
 * caller switches next, the diverged state to the caller, failures as toasts.
 */
export async function runCheckoutFromSource(
  request: CheckoutFromSourceRequest,
  sourceLabel: string,
  t: TFunction,
  checkout: boolean,
  /** How a finished move is described. Create and the drill-in keep the shared sync toast. */
  notice: 'synced' | 'fast-forward' | 'catch-up' = 'synced',
): Promise<{ ok: true; branch: string } | { ok: false; diverged: boolean }> {
  const result = await window.app.checkoutFromSource(request)
  if (result.ok) {
    const description = result.backupBranch ? t('chat.git.sourceBackup', { branch: result.backupBranch }) : undefined
    const message = checkout
      ? t('chat.git.sourceCheckedOutToast', { branch: result.branch, source: sourceLabel })
      : result.status === 'unchanged'
        ? t('chat.git.sourceUnchanged', { branch: result.branch })
        : notice === 'fast-forward'
          ? t('chat.git.syncFastForwarded', { branch: result.branch, source: sourceLabel })
          : notice === 'catch-up'
            ? t('chat.git.syncCaughtUp', { branch: result.branch, source: sourceLabel })
            : t('chat.git.sourceSynced', { branch: result.branch, source: sourceLabel })
    toast.success(message, description ? { description } : undefined)
    return { ok: true, branch: result.branch }
  }
  if (result.reason === 'diverged') return { ok: false, diverged: true }
  if (result.reason === 'cancelled') {
    toast.info(t('chat.git.sourceCancelled'))
    return { ok: false, diverged: false }
  }
  toast.error(t(ERROR_KEY[result.reason], { branch: result.branch ?? request.localName, source: sourceLabel }),
    result.error ? { description: result.error } : undefined)
  return { ok: false, diverged: false }
}

const PHASE_LABEL: Record<CheckoutProgressPhase, string> = {
  bundling: 'chat.git.progressBundling',
  downloading: 'chat.git.progressDownloading',
  uploading: 'chat.git.progressUploading',
  fetching: 'chat.git.progressFetching',
  applying: 'chat.git.progressApplying',
}

/** A running checkout: the step, bytes and a bar while transferring, and Cancel until it lands. */
export function CheckoutProgressLine({ progress, fallback, onCancel }: {
  progress: Omit<CheckoutProgress, 'operationId'> | null
  /** Shown before the first step arrives. */
  fallback: string
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const sized = !!progress?.total && progress.done !== undefined
  const label = progress
    ? t(PHASE_LABEL[progress.phase], sized ? { done: formatBytes(progress.done!), total: formatBytes(progress.total!) } : {})
    : fallback
  return (
    <div className="space-y-1.5" role="status">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <button type="button" disabled={progress?.phase === 'applying'} onClick={onCancel}
          className="shrink-0 underline-offset-2 hover:underline disabled:opacity-50 disabled:hover:no-underline">
          {t('common.cancel')}
        </button>
      </div>
      {sized && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-1 bg-primary transition-[width]" style={{ width: `${Math.min(100, Math.round((progress!.done! / progress!.total!) * 100))}%` }} />
        </div>
      )}
    </div>
  )
}

/** Fetch a git remote on open once its last fetch is older than this. */
const REMOTE_STALE_MS = 5 * 60_000

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; branches: CheckoutSourceBranch[]; fetchedAt?: number }
  | Extract<CheckoutSourceBranchesResult, { ok: false }> & { status: 'failed' }

export interface CheckoutSourcePanelProps {
  folderPath: string
  options: CheckoutSourceOption[]
  selected: CheckoutSourceOption
  onSelectSource: (option: CheckoutSourceOption) => void
  onBack: () => void
  /** The local checkout's uncommitted changes. */
  localDirty?: GitDirtyStatus
  onLanded: (landed: LandedBranch) => void
  /** Open with this branch expanded (a diverged badge in the branch list). */
  initialRef?: string
}

function rowDetail(branch: CheckoutSourceBranch, group: CheckoutSourceGroup, locale: string, t: TFunction, prefix?: string): ReactNode {
  const parts: ReactNode[] = []
  if (prefix) parts.push(prefix)
  if (branch.detail) parts.push(branch.detail)
  if (branch.fork) parts.push(t('chat.git.sourceFork'))
  if (group === 'node' && branch.checkedOut) parts.push(t('chat.git.sourceCheckedOut'))
  if (branch.updatedAt) {
    const age = formatCompactAge(new Date(branch.updatedAt).toISOString(), { locale })
    if (age) parts.push(age)
  }
  if (!parts.length && !branch.dirty) return null
  return (
    <span className="truncate text-[11px] text-muted-foreground">
      {parts.map((part, index) => <span key={index}>{index > 0 && ' · '}{part}</span>)}
      {branch.dirty && <span>{parts.length > 0 && ' · '}<DiffStat stat={branch.dirty} /></span>}
    </span>
  )
}

/** The expanded actions for one source branch: create, sync, or resolve a divergence. */
function SourceBranchEditor({ folderPath, sourceLabel, source, branch, localDirty, onLanded, onBusy }: {
  folderPath: string
  sourceLabel: string
  source: CheckoutSource
  branch: CheckoutSourceBranch
  localDirty?: GitDirtyStatus
  onLanded: (landed: LandedBranch) => void
  onBusy?: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<Omit<CheckoutProgress, 'operationId'> | null>(null)
  const operation = useRef<string | null>(null)
  const live = useRef(true)
  const [localName, setLocalName] = useState(branch.localName)
  const [carry, setCarry] = useState(true)
  const [busy, setBusy] = useState(false)
  const [diverged, setDiverged] = useState(branch.relation === 'diverged')
  const [saveAs, setSaveAs] = useState(`${branch.localName}-${sourceLabel}`)

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  useEffect(() => window.app.onCheckoutProgress((event) => {
    if (event.operationId !== operation.current) return
    setProgress({ phase: event.phase, ...(event.done !== undefined ? { done: event.done } : {}), ...(event.total !== undefined ? { total: event.total } : {}) })
  }), [])

  const run = async (opts: { checkout: boolean; name?: string; overwrite?: boolean; createOnly?: boolean }) => {
    if (busy) return
    const name = (opts.name ?? localName).trim() || branch.localName
    const operationId = crypto.randomUUID()
    operation.current = operationId
    setProgress(null)
    setBusy(true)
    onBusy?.(true)
    try {
      const outcome = await runCheckoutFromSource({
        folderPath,
        operationId,
        source,
        branch: { ref: branch.ref, head: branch.head },
        localName: name,
        ...(branch.dirty && carry ? { includeWorkingTree: true } : {}),
        ...(opts.overwrite ? { onDiverged: 'overwrite' as const } : {}),
        ...(opts.createOnly || name !== branch.localName ? { createOnly: true } : {}),
      }, sourceLabel, t, opts.checkout)
      if (outcome.ok) onLanded({ branch: outcome.branch, checkout: opts.checkout })
      else if (outcome.diverged && live.current) {
        setDiverged(true)
        setSaveAs(`${name}-${sourceLabel}`)
      }
    } finally {
      operation.current = null
      onBusy?.(false)
      if (live.current) {
        setProgress(null)
        setBusy(false)
      }
    }
  }

  return (
    <div className="space-y-2 bg-accent/50 px-3 py-2 text-xs">
      {busy ? (
        <CheckoutProgressLine
          progress={progress}
          fallback={t('chat.git.sourceRunning', { branch: localName || branch.localName, source: sourceLabel })}
          onCancel={() => { if (operation.current) void window.app.cancelCheckout(operation.current) }}
        />
      ) : diverged ? (
        <>
          <p className="text-amber-600 dark:text-amber-400">{t('chat.git.sourceDiverged', { branch: branch.localName, source: sourceLabel })}</p>
          <button type="button" className={`${buttonClass} w-full`} onClick={() => { void run({ checkout: false, name: branch.localName, overwrite: true }) }}>
            {t('chat.git.sourceOverwrite')}
          </button>
          <div className="flex gap-1.5">
            <input
              type="text"
              aria-label={t('chat.git.sourceSaveAs')}
              value={saveAs}
              onChange={(event) => setSaveAs(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <button type="button" disabled={!saveAs.trim()} className={buttonClass}
              onClick={() => { void run({ checkout: false, name: saveAs, createOnly: true }) }}>
              {t('chat.git.sourceSaveAs')}
            </button>
          </div>
        </>
      ) : (
        <BranchActions
          branch={branch}
          localName={localName}
          onLocalName={setLocalName}
          carry={carry}
          onCarry={() => setCarry((value) => !value)}
          localDirty={localDirty}
          onRun={(checkout) => { void run({ checkout }) }}
        />
      )}
    </div>
  )
}

/** One source's branches; picking one lands it as a local branch, optionally switching to it. */
export function CheckoutSourcePanel({ folderPath, options, selected, onSelectSource, onBack, localDirty, onLanded, initialRef }: CheckoutSourcePanelProps) {
  const { t, i18n } = useTranslation()
  const [menu, setMenu] = useState(false)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const loadToken = useRef(0)
  const [query, setQuery] = useState('')
  const [openRef, setOpenRef] = useState<string | null>(initialRef ?? null)
  const [rowBusy, setRowBusy] = useState(false)

  /**
   * List the source. A git remote shows its last-fetched branches at once and
   * fetches in the background when they are stale (or `force`).
   */
  const load = useCallback(async (force: boolean) => {
    const token = ++loadToken.current
    const live = () => loadToken.current === token
    const read = (fetch: boolean) => window.app.listCheckoutSourceBranches(folderPath, selected.source, fetch ? { fetch: true } : undefined)
    const settle = (result: CheckoutSourceBranchesResult) => setList(result.ok
      ? { status: 'ready', branches: result.branches, ...(result.fetchedAt ? { fetchedAt: result.fetchedAt } : {}) }
      : { ...result, status: 'failed' })
    try {
      let shown = false
      if (!force) {
        const cached = await read(false)
        if (!live()) return
        settle(cached)
        shown = cached.ok
        const fresh = cached.ok && !!cached.fetchedAt && Date.now() - cached.fetchedAt < REMOTE_STALE_MS
        if (selected.group !== 'remote' || fresh || (!cached.ok && cached.reason !== 'error')) return
      }
      setRefreshing(true)
      const fetched = await read(true)
      if (!live()) return
      if (fetched.ok || !shown) settle(fetched)
      else toast.error(t('chat.git.sourceFetchFailed', { source: selected.label }), fetched.error ? { description: fetched.error } : undefined)
    } catch (err) {
      if (live()) setList({ status: 'failed', ok: false, reason: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (live()) setRefreshing(false)
    }
  }, [folderPath, selected.source, selected.group, selected.label, t])

  useEffect(() => {
    setList({ status: 'loading' })
    void load(false)
    return () => { loadToken.current++ }
  }, [load])

  const branches = list.status === 'ready' ? list.branches : []
  const lowerQuery = query.trim().toLowerCase()
  const visible = useMemo(() => lowerQuery
    ? branches.filter((branch) => branch.title.toLowerCase().includes(lowerQuery) || branch.localName.toLowerCase().includes(lowerQuery))
    : branches, [branches, lowerQuery])

  const toggle = (branch: CheckoutSourceBranch) => {
    if (rowBusy) return
    setOpenRef((current) => current === branch.ref ? null : branch.ref)
  }

  const fetchedAge = list.status === 'ready' && list.fetchedAt
    ? formatCompactAge(new Date(list.fetchedAt).toISOString(), { locale: i18n.language })
    : null

  const empty = selected.group === 'pr' ? t('chat.git.sourceEmptyPulls') : t('chat.git.sourceEmpty')
  const failure = list.status === 'failed'
    ? list.reason === 'unsupported'
      ? t('chat.git.sourceUnsupported')
      : list.reason === 'unavailable'
        ? (selected.group === 'pr' ? t('chat.git.sourceGhUnavailable') : t('chat.git.sourceUnavailable', { source: selected.label }))
        : t('chat.git.sourceListFailed')
    : null

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <button type="button" aria-label={t('common.back')} onClick={onBack} className="-ml-1 rounded p-0.5 hover:bg-accent">
          <ArrowLeft className="size-3" />
        </button>
        <span className="min-w-0 flex-1 truncate">
          <Trans i18nKey="chat.git.sourceHeader" components={{ source: <SourceChip option={selected} expanded={menu} onClick={() => setMenu((open) => !open)} /> }} />
        </span>
        {selected.group === 'remote' && (
          <>
            {list.status === 'ready' && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {refreshing
                  ? t('chat.git.sourceFetching', { source: selected.label })
                  : fetchedAge ? t('chat.git.sourceFetchedAt', { age: fetchedAge }) : list.fetchedAt ? t('chat.git.sourceFetchedNow') : null}
              </span>
            )}
            <button type="button" aria-label={t('chat.git.sourceRefresh')} title={t('chat.git.sourceRefresh')} disabled={refreshing}
              onClick={() => { void load(true) }} className="shrink-0 rounded p-0.5 hover:bg-accent disabled:opacity-50">
              <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </>
        )}
      </div>
      {menu && (
        <CheckoutSourceMenu options={options} selectedId={selected.id} onSelect={(option) => {
          setMenu(false)
          setOpenRef(null)
          setQuery('')
          onSelectSource(option)
        }} />
      )}
      <div className="border-t px-3 py-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={selected.group === 'pr' ? t('chat.git.sourceSearchPulls') : t('chat.git.sourceSearchBranches', { source: selected.label })}
          className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-55 overflow-y-auto overscroll-contain border-t">
        {list.status === 'loading' && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {selected.group === 'remote' ? t('chat.git.sourceFetching', { source: selected.label }) : t('chat.git.sourceLoading')}
          </div>
        )}
        {failure && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">{failure}</span>
            {list.status === 'failed' && list.reason === 'error' && (
              <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={() => { setList({ status: 'loading' }); void load(false) }}>{t('chat.git.sourceRetry')}</button>
            )}
          </div>
        )}
        {list.status === 'ready' && visible.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">{lowerQuery ? t('chat.worktree.noMatches') : empty}</div>
        )}
        {visible.map((branch) => {
          const open = openRef === branch.ref
          return (
            <div key={branch.ref}>
              <button type="button" aria-expanded={open} onClick={() => toggle(branch)} className={`${rowClass} ${open ? 'bg-accent' : ''}`}>
                {selected.group === 'pr' ? <GitPullRequest className="size-3 shrink-0 text-muted-foreground" /> : <GitBranch className="size-3 shrink-0 text-muted-foreground" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{branch.title}</span>
                  {rowDetail(branch, selected.group, i18n.language, t)}
                </span>
                <RelationPill relation={branch.relation} behind={branch.behind} />
              </button>
              {open && (
                <SourceBranchEditor
                  folderPath={folderPath}
                  sourceLabel={selected.label}
                  source={selected.source}
                  branch={branch}
                  localDirty={localDirty}
                  onBusy={setRowBusy}
                  onLanded={(landed) => {
                    onLanded(landed)
                    if (!landed.checkout) {
                      setOpenRef(null)
                      void load(false)
                    }
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BranchActions({ branch, localName, onLocalName, carry, onCarry, localDirty, onRun }: {
  branch: CheckoutSourceBranch
  localName: string
  onLocalName: (name: string) => void
  carry: boolean
  onCarry: () => void
  localDirty?: GitDirtyStatus
  onRun: (checkout: boolean) => void
}) {
  const { t } = useTranslation()
  const isNew = branch.relation === 'new'
  const carries = !!branch.dirty && carry
  const primary = isNew
    ? t('chat.git.sourceCreateAndCheckOut')
    : branch.relation === 'behind' || branch.relation === 'update' || carries
      ? t('chat.git.sourceSyncAndCheckOut')
      : t('chat.git.sourceCheckOut')
  // Nothing to bring over: checking out is the only thing left to do.
  const secondary = isNew
    ? t('chat.git.sourceCreateOnly')
    : branch.relation === 'behind' || branch.relation === 'update' || carries ? t('chat.git.sourceSyncOnly') : null
  return (
    <>
      {isNew && (
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{t('chat.git.sourceLocalName')}</span>
          <input
            type="text"
            value={localName}
            onChange={(event) => onLocalName(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      )}
      {branch.dirty && (
        <button type="button" role="checkbox" aria-checked={carry} onClick={onCarry} className="flex w-full items-center gap-2 rounded-sm py-0.5 text-left hover:bg-accent">
          <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-sm border ${carry ? 'border-foreground bg-foreground' : 'border-muted-foreground'}`}>
            {carry && <Check className="size-2.5 text-background" />}
          </span>
          <span className="min-w-0">{t('chat.git.sourceCarry')}</span>
          <span className="ml-auto shrink-0 text-muted-foreground"><DiffStat stat={branch.dirty} /></span>
        </button>
      )}
      {localDirty && localDirty.files > 0 && (
        <p className="text-[11px] text-muted-foreground">{t('chat.git.sourceLocalDirtyHint')}</p>
      )}
      <div className="flex gap-1.5">
        <button type="button" disabled={isNew && !localName.trim()} className={`${primaryClass} flex-1`} onClick={() => onRun(true)}>{primary}</button>
        {secondary && (
          <button type="button" disabled={isNew && !localName.trim()} className={buttonClass} onClick={() => onRun(false)}>{secondary}</button>
        )}
      </div>
    </>
  )
}

export interface IncomingBranchItem {
  option: CheckoutSourceOption
  branch: CheckoutSourceBranch
}

function incomingKey(item: IncomingBranchItem): string {
  return `${item.option.id}\0${item.branch.ref}`
}

/**
 * Git remotes and pull requests in the same list as local branches.
 * One click checks the branch out. A divergence opens the resolve actions.
 */
export function DirectCheckoutRows({ folderPath, items, onLanded }: {
  folderPath: string
  items: IncomingBranchItem[]
  onLanded: (landed: LandedBranch) => void
}) {
  const { t } = useTranslation()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [progress, setProgress] = useState<Omit<CheckoutProgress, 'operationId'> | null>(null)
  const [divergedKey, setDivergedKey] = useState<string | null>(null)
  const operation = useRef<string | null>(null)

  const run = async (item: IncomingBranchItem) => {
    if (operation.current) return
    const key = incomingKey(item)
    const operationId = crypto.randomUUID()
    operation.current = operationId
    setBusyKey(key)
    setDivergedKey(null)
    setProgress(null)
    const stop = window.app.onCheckoutProgress((event) => {
      if (event.operationId !== operationId) return
      setProgress({
        phase: event.phase,
        ...(event.done !== undefined ? { done: event.done } : {}),
        ...(event.total !== undefined ? { total: event.total } : {}),
      })
    })
    try {
      const branch = item.branch
      const outcome = await runCheckoutFromSource({
        folderPath,
        operationId,
        source: item.option.source,
        branch: { ref: branch.ref, head: branch.head },
        localName: branch.localName,
        ...(branch.dirty ? { includeWorkingTree: true } : {}),
      }, item.option.label, t, true)
      if (outcome.ok) onLanded({ branch: outcome.branch, checkout: true })
      else if (outcome.diverged) setDivergedKey(key)
    } finally {
      stop()
      operation.current = null
      setBusyKey(null)
      setProgress(null)
    }
  }

  return (
    <>
      {items.map((item) => {
        const key = incomingKey(item)
        const busy = busyKey === key
        const diverged = divergedKey === key
        return (
          <div key={key}>
            <button
              type="button"
              disabled={busy}
              aria-expanded={diverged}
              onClick={() => {
                if (busy) return
                if (diverged) { setDivergedKey(null); return }
                void run(item)
              }}
              className={`${rowClass} disabled:opacity-50`}
            >
              {item.option.group === 'pr'
                ? <GitPullRequest className="size-3 shrink-0 text-muted-foreground" />
                : <GitBranch className="size-3 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{item.branch.title}</span>
            </button>
            {busy && (
              <div className="px-3 pb-2">
                <CheckoutProgressLine
                  progress={progress}
                  fallback={t('chat.git.sourceRunning', { branch: item.branch.localName, source: item.option.label })}
                  onCancel={() => { if (operation.current) void window.app.cancelCheckout(operation.current) }}
                />
              </div>
            )}
            {diverged && (
              <SourceBranchEditor
                folderPath={folderPath}
                sourceLabel={item.option.label}
                source={item.option.source}
                branch={{ ...item.branch, relation: 'diverged' }}
                onLanded={onLanded}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

/** Two-line sync rows. Selecting one does not open actions here; the parent keeps those below the list. */
function SyncBranchRows({ items, selectedKey, onSelect }: {
  items: IncomingBranchItem[]
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      {items.map((item) => {
        const key = incomingKey(item)
        const selected = key === selectedKey
        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(key)}
            className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:shadow-none ${selected ? 'bg-accent' : ''}`}
          >
            <GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{item.branch.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {t('chat.git.syncBranchDetail', {
                  source: item.option.label,
                  relation: syncStatusText(item.branch, t),
                })}
              </span>
            </span>
            {selected && <Check className="mt-0.5 size-3 shrink-0 text-primary" />}
          </button>
        )
      })}
    </div>
  )
}

/** Git remote and pull-request rows that share the checkout branch list. */
export function CheckoutBranchExtras({ folderPath, items, loading, onLanded }: {
  folderPath: string
  items: IncomingBranchItem[]
  loading?: boolean
  onLanded: (landed: LandedBranch) => void
}) {
  const { t } = useTranslation()
  const direct = items.filter((item) => item.option.group !== 'node')
  if (!loading && direct.length === 0) return null
  return (
    <>
      {loading && direct.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {t('chat.git.sourceLoading')}
        </div>
      )}
      {direct.length > 0 && <DirectCheckoutRows folderPath={folderPath} items={direct} onLanded={onLanded} />}
    </>
  )
}

/** The bottom row that opens environment sync. Matches the worktree base-branch row. */
export function EnvironmentSyncToggle({ open, sectionId, onToggle }: {
  open: boolean
  sectionId: string
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const title = t('chat.git.syncSection')
  return (
    <div className={open ? 'px-2 pt-2 pb-1.5' : 'border-t px-2 pt-2 pb-1.5'}>
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:shadow-none"
      >
        <ArrowLeftRight className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronRight className={`size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
      </button>
    </div>
  )
}

/** Local name for a tip brought onto this checkout. An existing name is not reused. */
function syncBranchName(branch: CheckoutSourceBranch, sourceLabel: string): string {
  return branch.relation === 'new' ? branch.localName : `${branch.localName}-${sourceLabel}`
}

/** This checkout as the origin of a catch-up. */
function executionSource(folderPath: string): CheckoutSource {
  const remote = parseRemoteProjectKey(folderPath)
  return { kind: 'node', connectionId: remote?.connectionId ?? 'local', folderPath }
}

/**
 * A linear tip moves an existing branch. The other side being ahead
 * fast-forwards this branch. This side being ahead fast-forwards theirs.
 * Anything else is created as a new branch.
 */
function syncMove(relation: BranchRelation): 'fast-forward' | 'catch-up' | null {
  if (relation === 'behind') return 'fast-forward'
  if (relation === 'ahead') return 'catch-up'
  return null
}

/**
 * The sync action: create a new branch here at the other environment's tip.
 * It never checks the branch out or moves a branch that already exists.
 */
function SyncBranchCreate({ folderPath, sourceLabel, source, branch, onLanded, onBusy }: {
  folderPath: string
  sourceLabel: string
  source: CheckoutSource
  branch: CheckoutSourceBranch
  onLanded: (landed: LandedBranch) => void
  onBusy?: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(() => syncBranchName(branch, sourceLabel))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Omit<CheckoutProgress, 'operationId'> | null>(null)
  const operation = useRef<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  useEffect(() => window.app.onCheckoutProgress((event) => {
    if (event.operationId !== operation.current) return
    setProgress({ phase: event.phase, ...(event.done !== undefined ? { done: event.done } : {}), ...(event.total !== undefined ? { total: event.total } : {}) })
  }), [])

  const run = async () => {
    const localName = name.trim()
    if (!localName || busy) return
    const operationId = crypto.randomUUID()
    operation.current = operationId
    setProgress(null)
    setBusy(true)
    onBusy?.(true)
    try {
      const outcome = await runCheckoutFromSource({
        folderPath,
        operationId,
        source,
        branch: { ref: branch.ref, head: branch.head },
        localName,
        createOnly: true,
      }, sourceLabel, t, false)
      if (outcome.ok) onLanded({ branch: outcome.branch, checkout: false })
    } finally {
      operation.current = null
      onBusy?.(false)
      if (live.current) {
        setProgress(null)
        setBusy(false)
      }
    }
  }

  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      {busy ? (
        <CheckoutProgressLine
          progress={progress}
          fallback={t('chat.git.sourceRunning', { branch: name.trim() || branch.localName, source: sourceLabel })}
          onCancel={() => { if (operation.current) void window.app.cancelCheckout(operation.current) }}
        />
      ) : (
        <>
          <label className="block text-muted-foreground" htmlFor={`sync-branch-${branch.ref}`}>{t('chat.git.sourceLocalName')}</label>
          <input
            id={`sync-branch-${branch.ref}`}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring focus-visible:shadow-none"
          />
          <button type="button" disabled={!name.trim()} className={`${primaryClass} w-full outline-none focus-visible:shadow-none`} onClick={() => { void run() }}>
            {t('chat.git.syncCreateBranch')}
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Fast-forward one of the two branches. The other environment being ahead
 * moves this branch. This branch being ahead moves theirs.
 */
function SyncBranchMove({ mode, folderPath, sourceLabel, source, branch, onLanded, onBusy }: {
  mode: 'fast-forward' | 'catch-up'
  folderPath: string
  sourceLabel: string
  source: CheckoutSource
  branch: CheckoutSourceBranch
  onLanded: (landed: LandedBranch) => void
  onBusy?: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Omit<CheckoutProgress, 'operationId'> | null>(null)
  const operation = useRef<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  useEffect(() => window.app.onCheckoutProgress((event) => {
    if (event.operationId !== operation.current) return
    setProgress({ phase: event.phase, ...(event.done !== undefined ? { done: event.done } : {}), ...(event.total !== undefined ? { total: event.total } : {}) })
  }), [])

  const run = async () => {
    if (busy) return
    const other = source.kind === 'node' ? source : null
    if (mode === 'catch-up' && !other) return
    const operationId = crypto.randomUUID()
    operation.current = operationId
    setProgress(null)
    setBusy(true)
    onBusy?.(true)
    const request: CheckoutFromSourceRequest = mode === 'fast-forward' || !other
      ? {
          folderPath,
          operationId,
          source,
          branch: { ref: branch.ref, head: branch.head },
          localName: branch.localName,
        }
      : {
          folderPath: other.folderPath,
          operationId,
          source: executionSource(folderPath),
          branch: { ref: branch.localName, head: branch.head },
          localName: branch.localName,
        }
    try {
      const outcome = await runCheckoutFromSource(request, sourceLabel, t, false, mode)
      if (outcome.ok) onLanded({ branch: outcome.branch, checkout: false })
      else if (outcome.diverged && live.current) toast.error(t('chat.git.syncMoveRefused', { branch: branch.localName }))
    } finally {
      operation.current = null
      onBusy?.(false)
      if (live.current) {
        setProgress(null)
        setBusy(false)
      }
    }
  }

  const label = mode === 'fast-forward' ? 'chat.git.syncFastForward' : 'chat.git.syncCatchUp'
  const hint = mode === 'fast-forward' ? 'chat.git.syncFastForwardHint' : 'chat.git.syncCatchUpHint'
  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      {busy ? (
        <CheckoutProgressLine
          progress={progress}
          fallback={t('chat.git.syncMoving', { branch: branch.localName })}
          onCancel={() => { if (operation.current) void window.app.cancelCheckout(operation.current) }}
        />
      ) : (
        <>
          <p className="text-muted-foreground">{t(hint)}</p>
          <button type="button" className={`${primaryClass} w-full outline-none focus-visible:shadow-none`} onClick={() => { void run() }}>
            {t(label)}
          </button>
        </>
      )}
    </div>
  )
}

/** The action grows in with the tab-body spring. Closed, it takes no space. */
function SyncActionHeight({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={false}
      animate={{ height: open ? 'auto' : 0 }}
      transition={reduceMotion ? { duration: 0 } : ACTION_PANEL_SPRING}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

/** Environment branches to sync. The parent raises this over the branch list. */
export function EnvironmentSyncBody({ sectionId, folderPath, items, loading, notices, emptyLabel, initialRef, onLanded }: {
  sectionId: string
  folderPath: string
  items: IncomingBranchItem[]
  loading?: boolean
  notices: Array<{ id: string; text: string }>
  emptyLabel?: string | null
  /** Branch ref to select on the first render. */
  initialRef?: string
  onLanded: (landed: LandedBranch) => void
}) {
  const { t } = useTranslation()
  const listFade = useScrollEdgeFade<HTMLDivElement>()
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const item = initialRef ? items.find((entry) => entry.branch.ref === initialRef) : undefined
    return item ? incomingKey(item) : null
  })
  const [rowBusy, setRowBusy] = useState(false)
  const selected = items.find((item) => incomingKey(item) === selectedKey) ?? null
  const move = selected ? syncMove(selected.branch.relation) : null
  return (
    <div id={sectionId} data-slot="workdir-sync-list" className="pb-2">
      {notices.map((notice) => (
        <div key={notice.id} className="px-3 py-1.5 text-xs text-muted-foreground">{notice.text}</div>
      ))}
      <div ref={listFade} data-slot="workdir-sync-branches" className="scroll-edge-fade-y max-h-55 overflow-y-auto overscroll-contain">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t('chat.git.sourceLoading')}
          </div>
        )}
        {!loading && items.length === 0 && notices.length === 0 && emptyLabel && (
          <div className="px-3 py-1 text-xs text-muted-foreground">{emptyLabel}</div>
        )}
        {items.length > 0 && (
          <SyncBranchRows
            items={items}
            selectedKey={selected ? selectedKey : null}
            onSelect={(key) => { if (!rowBusy) setSelectedKey(key) }}
          />
        )}
      </div>
      <SyncActionHeight open={!!selected}>
        {selected && (
          <div className="border-t" data-slot="workdir-sync-actions">
            <div className="truncate px-3 pt-2 font-mono text-xs">{selected.branch.title}</div>
            {move ? (
              <SyncBranchMove
                key={incomingKey(selected)}
                mode={move}
                folderPath={folderPath}
                sourceLabel={selected.option.label}
                source={selected.option.source}
                branch={selected.branch}
                onBusy={setRowBusy}
                onLanded={onLanded}
              />
            ) : (
              <SyncBranchCreate
                key={incomingKey(selected)}
                folderPath={folderPath}
                sourceLabel={selected.option.label}
                source={selected.option.source}
                branch={selected.branch}
                onBusy={setRowBusy}
                onLanded={onLanded}
              />
            )}
          </div>
        )}
      </SyncActionHeight>
    </div>
  )
}
