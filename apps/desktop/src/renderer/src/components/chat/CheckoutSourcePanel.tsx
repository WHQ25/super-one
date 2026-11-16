import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { ArrowLeft, Check, ChevronDown, Download, GitBranch, GitPullRequest, Globe, Loader2, RefreshCw } from 'lucide-react'
import type {
  BranchImportResult,
  BranchRelation,
  CheckoutFromSourceRequest,
  CheckoutProgress,
  CheckoutProgressPhase,
  CheckoutSourceBranch,
  CheckoutSourceBranchesResult,
  GitDirtyStatus,
} from '@superone/shared/agent-types'
import { formatBytes } from '@superone/shared/format-bytes'
import { formatCompactAge } from '@superone/shared/relative-time'
import { EnvironmentKindIcon } from '@/components/sidebar/multi-host/EnvironmentKindIcon'
import { DiffStat } from './DiffStat'
import type { CheckoutSourceGroup, CheckoutSourceOption } from './checkout-sources'

const rowClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent'
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
): Promise<{ ok: true; branch: string } | { ok: false; diverged: boolean }> {
  const result = await window.app.checkoutFromSource(request)
  if (result.ok) {
    const description = result.backupBranch ? t('chat.git.sourceBackup', { branch: result.backupBranch }) : undefined
    const message = checkout
      ? t('chat.git.sourceCheckedOutToast', { branch: result.branch, source: sourceLabel })
      : result.status === 'unchanged'
        ? t('chat.git.sourceUnchanged', { branch: result.branch })
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

function rowDetail(branch: CheckoutSourceBranch, group: CheckoutSourceGroup, locale: string, t: TFunction): ReactNode {
  const parts: ReactNode[] = []
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

/** One source's branches; picking one lands it as a local branch, optionally switching to it. */
export function CheckoutSourcePanel({ folderPath, options, selected, onSelectSource, onBack, localDirty, onLanded, initialRef }: CheckoutSourcePanelProps) {
  const { t, i18n } = useTranslation()
  const [menu, setMenu] = useState(false)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState<Omit<CheckoutProgress, 'operationId'> | null>(null)
  const operation = useRef<string | null>(null)
  const loadToken = useRef(0)
  const [query, setQuery] = useState('')
  const [openRef, setOpenRef] = useState<string | null>(initialRef ?? null)
  const [localName, setLocalName] = useState('')
  const [carry, setCarry] = useState(true)
  const [busy, setBusy] = useState(false)
  const [diverged, setDiverged] = useState<string | null>(null)
  const [saveAs, setSaveAs] = useState('')

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

  useEffect(() => window.app.onCheckoutProgress((event) => {
    if (event.operationId !== operation.current) return
    setProgress({ phase: event.phase, ...(event.done !== undefined ? { done: event.done } : {}), ...(event.total !== undefined ? { total: event.total } : {}) })
  }), [])

  const branches = list.status === 'ready' ? list.branches : []
  const lowerQuery = query.trim().toLowerCase()
  const visible = useMemo(() => lowerQuery
    ? branches.filter((branch) => branch.title.toLowerCase().includes(lowerQuery) || branch.localName.toLowerCase().includes(lowerQuery))
    : branches, [branches, lowerQuery])

  const toggle = (branch: CheckoutSourceBranch) => {
    if (busy) return
    setOpenRef((current) => current === branch.ref ? null : branch.ref)
    setLocalName(branch.localName)
    setCarry(true)
    setDiverged(branch.relation === 'diverged' ? branch.ref : null)
    setSaveAs(`${branch.localName}-${selected.label}`)
  }

  useEffect(() => {
    // A badge opened the panel on a branch: expand it once the list arrives.
    const branch = initialRef ? branches.find((item) => item.ref === initialRef) : undefined
    if (!branch) return
    setLocalName(branch.localName)
    setDiverged(branch.relation === 'diverged' ? branch.ref : null)
    setSaveAs(`${branch.localName}-${selected.label}`)
  }, [initialRef, branches, selected.label])

  const run = async (branch: CheckoutSourceBranch, opts: { checkout: boolean; name?: string; overwrite?: boolean; createOnly?: boolean }) => {
    if (busy) return
    const name = (opts.name ?? localName).trim() || branch.localName
    const operationId = crypto.randomUUID()
    operation.current = operationId
    setProgress(null)
    setBusy(true)
    try {
      const outcome = await runCheckoutFromSource({
        folderPath,
        operationId,
        source: selected.source,
        branch: { ref: branch.ref, head: branch.head },
        localName: name,
        ...(branch.dirty && carry ? { includeWorkingTree: true } : {}),
        ...(opts.overwrite ? { onDiverged: 'overwrite' as const } : {}),
        ...(opts.createOnly || name !== branch.localName ? { createOnly: true } : {}),
      }, selected.label, t, opts.checkout)
      if (outcome.ok) {
        onLanded({ branch: outcome.branch, checkout: opts.checkout })
        if (!opts.checkout) {
          setOpenRef(null)
          void load(false)
        }
      } else if (outcome.diverged) {
        setDiverged(branch.ref)
        setSaveAs(`${name}-${selected.label}`)
      }
    } finally {
      operation.current = null
      setProgress(null)
      setBusy(false)
    }
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
      <div className="max-h-80 overflow-y-auto border-t">
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
                <div className="space-y-2 bg-accent/50 px-3 py-2 text-xs">
                  {busy ? (
                    <CheckoutProgressLine
                      progress={progress}
                      fallback={t('chat.git.sourceRunning', { branch: localName || branch.localName, source: selected.label })}
                      onCancel={() => { if (operation.current) void window.app.cancelCheckout(operation.current) }}
                    />
                  ) : diverged === branch.ref ? (
                    <>
                      <p className="text-amber-600 dark:text-amber-400">{t('chat.git.sourceDiverged', { branch: branch.localName, source: selected.label })}</p>
                      <button type="button" className={`${buttonClass} w-full`} onClick={() => { void run(branch, { checkout: false, name: branch.localName, overwrite: true }) }}>
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
                          onClick={() => { void run(branch, { checkout: false, name: saveAs, createOnly: true }) }}>
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
                      onRun={(checkout) => { void run(branch, { checkout }) }}
                    />
                  )}
                </div>
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
