import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import {
  CodexPluginDirectoryError,
  codexPluginShelf,
  type CodexPluginDetail,
  type CodexPluginDirectoryResult,
  type CodexPluginShelfCard,
  type CodexPluginShelfSection,
} from '@superone/shared/codex-plugin-shelf'
import { requestOpenExternalLink } from '@/lib/external-link'
import { useAppStore } from '@/stores/app'
import { SettingsEmptyState, SettingsLoadingState } from '@/components/settings/SettingsEmptyState'
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl'

type DirectoryTab = 'public' | 'personal'
const CATEGORY_PAGE_CAP = 20

function useDocumentDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains('dark'))
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function errorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  if (
    message === CodexPluginDirectoryError.signedOut
    || message === CodexPluginDirectoryError.expired
    || message === CodexPluginDirectoryError.remoteInstall
  ) return message
  return CodexPluginDirectoryError.unavailable
}

export function CodexPluginDirectory({ onAddMarketplace }: { onAddMarketplace: () => void }) {
  const { t } = useTranslation()
  const projectPath = useAppStore((s) => s.currentFolder) ?? ''
  const dark = useDocumentDark()
  const [tab, setTab] = useState<DirectoryTab>('public')
  const [query, setQuery] = useState('')
  const [directory, setDirectory] = useState<CodexPluginDirectoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorCodeValue, setErrorCodeValue] = useState<string | null>(null)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [detailCard, setDetailCard] = useState<CodexPluginShelfCard | null>(null)
  const [categoryReload, setCategoryReload] = useState(0)
  const [personal, setPersonal] = useState<CodexPluginShelfCard[] | null>(null)
  const [personalRemote, setPersonalRemote] = useState(false)
  const [personalLoading, setPersonalLoading] = useState(false)
  const [personalError, setPersonalError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<CodexPluginShelfCard[] | null>(null)
  const [searchRemote, setSearchRemote] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const messageFor = useCallback((code: string | null) => {
    if (code === CodexPluginDirectoryError.signedOut) return t('resources.plugins.directorySignedOut')
    if (code === CodexPluginDirectoryError.expired) return t('resources.plugins.directoryExpired')
    if (code === CodexPluginDirectoryError.remoteInstall) return t('resources.plugins.remoteInstallUnavailable')
    return t('resources.plugins.directoryError')
  }, [t])

  const loadDirectory = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    try {
      const result = await window.app.codexListPluginDirectory(projectPath)
      if (!result || !Array.isArray(result.sections)) throw new Error(CodexPluginDirectoryError.unavailable)
      setDirectory(result)
      setErrorCodeValue(null)
    } catch (err) {
      const code = errorCode(err)
      if (mode === 'initial') {
        setDirectory(null)
        setErrorCodeValue(code)
      } else {
        toast.error(messageFor(code))
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [messageFor, projectPath])

  useEffect(() => {
    setPersonal(null)
    setSectionId(null)
    setDetailCard(null)
    void loadDirectory('initial')
  }, [loadDirectory])

  useEffect(() => {
    if (tab !== 'personal' || personal) return
    let cancelled = false
    setPersonalLoading(true)
    setPersonalError(null)
    void window.app.codexListPersonalPlugins(projectPath).then((result) => {
      if (cancelled) return
      setPersonal(result?.plugins ?? [])
      setPersonalRemote(Boolean(result?.remote))
    }).catch((err: unknown) => {
      if (!cancelled) setPersonalError(errorCode(err))
    }).finally(() => {
      if (!cancelled) setPersonalLoading(false)
    })
    return () => { cancelled = true }
  }, [personal, projectPath, tab])

  useEffect(() => {
    if (tab !== 'public') return
    const term = query.trim()
    if (!term) {
      setSearchResult(null)
      setSearching(false)
      setSearchError(null)
      setSearchRemote(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      void window.app.codexSearchPlugins(projectPath, term).then((result) => {
        if (cancelled) return
        setSearchResult(result?.plugins ?? [])
        setSearchRemote(Boolean(result?.remote))
        setSearchError(null)
      }).catch((err: unknown) => {
        if (cancelled) return
        setSearchError(errorCode(err))
        setSearchResult([])
      }).finally(() => {
        if (!cancelled) setSearching(false)
      })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectPath, query, tab])

  const section = directory?.sections.find((entry) => entry.id === sectionId) ?? null
  const remote = tab === 'personal'
    ? personalRemote
    : query.trim()
      ? searchRemote
      : Boolean(directory?.remote)

  const reloadAfterChange = useCallback(async () => {
    setPersonal(null)
    setCategoryReload((value) => value + 1)
    await loadDirectory('refresh')
  }, [loadDirectory])

  const install = useCallback(async (card: CodexPluginShelfCard) => {
    if (!card.install || remote) return
    setBusyId(card.id)
    try {
      await window.app.codexInstallPluginTarget(projectPath, card.install)
      await reloadAfterChange()
    } catch (err) {
      toast.error(messageFor(errorCode(err)))
    } finally {
      setBusyId(null)
    }
  }, [messageFor, projectPath, reloadAfterChange, remote])

  const uninstall = useCallback(async (card: CodexPluginShelfCard) => {
    if (!card.installedKey) return
    setBusyId(card.id)
    try {
      await window.app.codexDeletePlugin(projectPath, card.installedKey, 'user')
      await reloadAfterChange()
    } catch (err) {
      toast.error(messageFor(errorCode(err)))
    } finally {
      setBusyId(null)
    }
  }, [messageFor, projectPath, reloadAfterChange])

  const personalShown = useMemo(() => {
    const list = personal ?? []
    const term = query.trim().toLowerCase()
    if (!term) return list
    return list.filter((card) => card.name.toLowerCase().includes(term) || card.description.toLowerCase().includes(term))
  }, [personal, query])

  const gridProps = { remote, dark, busyId, onInstall: install, onUninstall: uninstall, onOpen: setDetailCard }

  let body = null
  if (detailCard) {
    body = (
      <PluginDetail
        key={detailCard.id}
        card={detailCard}
        projectPath={projectPath}
        reloadToken={categoryReload}
        messageFor={messageFor}
        onBack={() => setDetailCard(null)}
        {...gridProps}
      />
    )
  } else if (loading && !directory) {
    body = <SettingsLoadingState label={t('resources.plugins.loading')} />
  } else if (errorCodeValue && !directory) {
    body = (
      <SettingsEmptyState
        title={messageFor(errorCodeValue)}
        action={(
          <Button size="sm" variant="outline" className="h-7" onClick={() => void loadDirectory('initial')}>
            {t('common.retry')}
          </Button>
        )}
      />
    )
  } else if (tab === 'personal') {
    body = personalLoading && !personal
      ? <SettingsLoadingState label={t('resources.plugins.loading')} />
      : personalError
        ? <SettingsEmptyState title={messageFor(personalError)} />
        : personalRemote
          ? <SettingsEmptyState title={t('resources.plugins.remoteDirectoryHint')} />
          : personalShown.length === 0
            ? (
              <SettingsEmptyState
                title={query.trim() ? t('resources.plugins.searchNoMatch') : t('resources.plugins.emptyPersonal')}
                hint={query.trim() ? undefined : t('resources.plugins.emptyPersonalHint')}
              />
            )
            : <PluginGrid cards={personalShown} {...gridProps} />
  } else if (query.trim()) {
    body = searching && !searchResult
      ? <SettingsLoadingState label={t('resources.plugins.searching')} />
      : searchError
        ? <SettingsEmptyState title={messageFor(searchError)} />
        : searchRemote
          ? <SettingsEmptyState title={t('resources.plugins.remoteDirectoryHint')} />
          : (searchResult ?? []).length === 0
            ? <SettingsEmptyState title={t('resources.plugins.searchNoMatch')} />
            : <PluginGrid cards={searchResult ?? []} {...gridProps} />
  } else if (section) {
    body = (
      <PluginCategory
        projectPath={projectPath}
        slug={section.urlSlug}
        fallbackTitle={section.title}
        reloadToken={categoryReload}
        messageFor={messageFor}
        onBack={() => setSectionId(null)}
        {...gridProps}
      />
    )
  } else if (!directory?.sections.length) {
    body = <SettingsEmptyState title={t('resources.plugins.emptyDirectory')} />
  } else {
    body = (
      <div className="space-y-8">
        {directory.sections.map((entry) => (
          <PluginSection key={entry.id} section={entry} onOpenSection={() => setSectionId(entry.id)} {...gridProps} />
        ))}
      </div>
    )
  }

  return (
    <div className="@container w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('resources.plugins.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('resources.plugins.subtitleCodex')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setDetailCard(null)
              }}
              placeholder={t('resources.plugins.directorySearchPlaceholder')}
              aria-label={t('resources.plugins.directorySearchPlaceholder')}
              className="h-8 w-56 max-w-full rounded-full border border-border bg-background pr-3 pl-8 text-sm outline-none focus:border-ring"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('common.refresh')}
            disabled={loading || refreshing}
            onClick={() => {
              setCategoryReload((value) => value + 1)
              void loadDirectory('refresh')
            }}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" className="h-8 rounded-full px-3">
                {t('resources.plugins.add')}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onAddMarketplace}>
                {t('resources.plugins.addMarketplace')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <SettingsSegmentedControl
        value={tab}
        onChange={(next) => {
          setTab(next)
          setSectionId(null)
          setDetailCard(null)
        }}
        label={t('resources.plugins.title')}
        className="mb-5"
        options={[
          { value: 'public', label: t('resources.plugins.tabPublic') },
          { value: 'personal', label: t('resources.plugins.tabPersonal') },
        ]}
      />

      {tab === 'public' && !query.trim() && directory?.remote ? (
        <p className="mb-4 text-xs text-muted-foreground">{t('resources.plugins.remoteDirectoryHint')}</p>
      ) : null}

      {body}
    </div>
  )
}

function PluginCategory({
  projectPath,
  slug,
  fallbackTitle,
  reloadToken,
  messageFor,
  onBack,
  ...gridProps
}: {
  projectPath: string
  slug: string
  fallbackTitle: string
  reloadToken: number
  messageFor: (code: string | null) => string
  onBack: () => void
} & GridProps) {
  const { t } = useTranslation()
  const requestRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [plugins, setPlugins] = useState<CodexPluginShelfCard[] | null>(null)
  const [title, setTitle] = useState(fallbackTitle)
  const [description, setDescription] = useState<string | null>(null)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageRemote, setPageRemote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const request = ++requestRef.current
    setPlugins(null)
    setError(null)
    setMoreError(null)
    setNextPageToken(null)
    setPageCount(1)
    setLoadingMore(false)
    setTitle(fallbackTitle)
    setDescription(null)
    void window.app.codexListPluginCategory(projectPath, slug, null).then((result) => {
      if (requestRef.current !== request) return
      if (!result || !Array.isArray(result.plugins)) throw new Error(CodexPluginDirectoryError.unavailable)
      setPlugins(result.plugins)
      setNextPageToken(result.nextPageToken)
      setTitle(result.title || fallbackTitle)
      setDescription(result.description)
      setPageRemote(Boolean(result.remote))
    }).catch((err: unknown) => {
      if (requestRef.current !== request) return
      setError(errorCode(err))
      setPlugins([])
    })
    return () => { requestRef.current += 1 }
  }, [attempt, fallbackTitle, projectPath, reloadToken, slug])

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore || pageCount >= CATEGORY_PAGE_CAP) return
    const request = requestRef.current
    const token = nextPageToken
    setLoadingMore(true)
    setMoreError(null)
    try {
      const result = await window.app.codexListPluginCategory(projectPath, slug, token)
      if (requestRef.current !== request) return
      if (!result || !Array.isArray(result.plugins)) throw new Error(CodexPluginDirectoryError.unavailable)
      setPlugins((current) => {
        const seen = new Set((current ?? []).map((card) => card.id))
        return [...(current ?? []), ...result.plugins.filter((card) => !seen.has(card.id))]
      })
      setNextPageToken(result.nextPageToken === token ? null : result.nextPageToken)
      setPageCount((count) => count + 1)
      setPageRemote(Boolean(result.remote))
    } catch (err) {
      if (requestRef.current === request) setMoreError(errorCode(err))
    } finally {
      if (requestRef.current === request) setLoadingMore(false)
    }
  }, [loadingMore, nextPageToken, pageCount, projectPath, slug])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !nextPageToken || loadingMore || moreError || pageCount >= CATEGORY_PAGE_CAP) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, loadingMore, moreError, nextPageToken, pageCount])

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        {t('common.back')}
      </button>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 mb-2 text-xs text-muted-foreground">{description}</p> : <div className="mb-2" />}
      {error ? (
        <SettingsEmptyState
          title={messageFor(error)}
          action={(
            <Button size="sm" variant="outline" className="h-7" onClick={() => setAttempt((value) => value + 1)}>
              {t('common.retry')}
            </Button>
          )}
        />
      ) : plugins == null ? (
        <SettingsLoadingState label={t('resources.plugins.loading')} />
      ) : plugins.length === 0 ? (
        <SettingsEmptyState title={t('resources.plugins.emptyDirectory')} />
      ) : (
        <>
          <PluginGrid cards={plugins} {...gridProps} remote={gridProps.remote || pageRemote} />
          {moreError ? (
            <div className="mt-3 flex items-center gap-2">
              <p className="text-xs text-muted-foreground">{messageFor(moreError)}</p>
              <Button size="sm" variant="outline" className="h-7" onClick={() => void loadMore()}>{t('common.retry')}</Button>
            </div>
          ) : nextPageToken && pageCount < CATEGORY_PAGE_CAP ? (
            <div ref={sentinelRef} className="mt-3 flex justify-center">
              {loadingMore ? (
                <p className="text-xs text-muted-foreground">{t('resources.plugins.loading')}</p>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => void loadMore()}>
                  {t('resources.plugins.loadMore')}
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function PluginSection({
  section,
  onOpenSection,
  ...gridProps
}: {
  section: CodexPluginShelfSection
  onOpenSection: () => void
} & GridProps) {
  return (
    <section>
      <button type="button" onClick={onOpenSection} className="mb-1 flex items-center gap-1 text-sm font-semibold text-foreground">
        {section.title}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </button>
      <PluginGrid cards={codexPluginShelf(section.plugins)} {...gridProps} />
    </section>
  )
}

interface GridProps {
  remote: boolean
  dark: boolean
  busyId: string | null
  onInstall: (card: CodexPluginShelfCard) => void
  onUninstall: (card: CodexPluginShelfCard) => void
  onOpen: (card: CodexPluginShelfCard) => void
}

function PluginGrid({ cards, ...rowProps }: { cards: CodexPluginShelfCard[] } & GridProps) {
  return (
    <div className="grid grid-cols-1 gap-x-10 @min-[520px]:grid-cols-2">
      {cards.map((card) => (
        <PluginRow key={card.id} card={card} {...rowProps} />
      ))}
    </div>
  )
}

function PluginRow({ card, remote, dark, busyId, onInstall, onUninstall, onOpen }: { card: CodexPluginShelfCard } & GridProps) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border/50 py-3">
      <button type="button" onClick={() => onOpen(card)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <ShelfIcon name={card.name} iconUrl={(dark && card.iconUrlDark) || card.iconUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{card.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{card.description}</span>
        </span>
      </button>
      <PluginRowAction card={card} remote={remote} busyId={busyId} onInstall={onInstall} onUninstall={onUninstall} />
    </div>
  )
}

function PluginDetail({
  card,
  projectPath,
  reloadToken,
  messageFor,
  onBack,
  remote,
  dark,
  busyId,
  onInstall,
  onUninstall,
}: {
  card: CodexPluginShelfCard
  projectPath: string
  reloadToken: number
  messageFor: (code: string | null) => string
  onBack: () => void
} & Omit<GridProps, 'onOpen'>) {
  const { t } = useTranslation()
  const requestRef = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [detail, setDetail] = useState<CodexPluginDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const request = ++requestRef.current
    setError(null)
    void window.app.codexGetPluginDetail(projectPath, card.id).then((result) => {
      if (requestRef.current !== request) return
      if (!result?.plugin || result.plugin.id !== card.id) throw new Error(CodexPluginDirectoryError.unavailable)
      setDetail(result.plugin)
    }).catch((err: unknown) => {
      if (requestRef.current !== request) return
      setError(errorCode(err))
    })
    return () => { requestRef.current += 1 }
  }, [attempt, card.id, projectPath, reloadToken])

  const shown = detail ?? card
  const iconUrl = (dark && (shown.iconUrlDark || card.iconUrlDark)) || shown.iconUrl || card.iconUrl

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        {t('common.back')}
      </button>
      <div className="flex min-w-0 items-start gap-3">
        <ShelfIcon name={shown.name} iconUrl={iconUrl} className="size-12 text-sm" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{shown.name}</h3>
          {shown.description ? <p className="mt-0.5 text-sm text-muted-foreground">{shown.description}</p> : null}
          {detail?.developerName ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('resources.plugins.detail.byDeveloper', { name: detail.developerName })}</p>
          ) : null}
        </div>
        <PluginRowAction card={shown} remote={remote} busyId={busyId} onInstall={onInstall} onUninstall={onUninstall} />
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{messageFor(error)}</p>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setAttempt((value) => value + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {!detail && !error ? <p className="mt-4 text-xs text-muted-foreground">{t('resources.plugins.loading')}</p> : null}

      {detail ? <PluginDetailBody detail={detail} dark={dark} /> : null}
    </div>
  )
}

function PluginDetailBody({ detail, dark }: { detail: CodexPluginDetail; dark: boolean }) {
  const { t } = useTranslation()
  const facts = [
    detail.developerName ? { label: t('resources.plugins.detail.developer'), value: detail.developerName } : null,
    detail.category ? { label: t('resources.plugins.detail.category'), value: detail.category } : null,
    detail.version ? { label: t('resources.plugins.detail.version'), value: detail.version } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null)
  const links = [
    detail.websiteUrl ? { label: t('resources.plugins.detail.website'), href: detail.websiteUrl } : null,
    detail.privacyPolicyUrl ? { label: t('resources.plugins.detail.privacy'), href: detail.privacyPolicyUrl } : null,
    detail.termsOfServiceUrl ? { label: t('resources.plugins.detail.terms'), href: detail.termsOfServiceUrl } : null,
  ].filter((link): link is { label: string; href: string } => link !== null)

  return (
    <div className="mt-5 space-y-6">
      {detail.longDescription ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{detail.longDescription}</p>
      ) : null}

      {detail.screenshotUrls.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-foreground">{t('resources.plugins.detail.screenshots')}</h4>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {detail.screenshotUrls.map((url) => (
              <DetailScreenshot key={url} url={url} />
            ))}
          </div>
        </section>
      ) : null}

      {detail.prompts.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-foreground">{t('resources.plugins.detail.starterPrompts')}</h4>
          <ul className="mt-2 space-y-1">
            {detail.prompts.map((prompt) => (
              <li key={prompt} className="text-sm text-muted-foreground">{prompt}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.apps.length > 0 ? (
        <PluginResourceList title={t('resources.plugins.detail.apps')} rows={detail.apps} dark={dark} iconClassName="size-9" />
      ) : null}

      {detail.skills.length > 0 ? (
        <PluginResourceList
          title={t('resources.plugins.detail.skills')}
          rows={detail.skills.map((skill, index) => ({ ...skill, id: `${skill.name}-${index}` }))}
          dark={dark}
          iconClassName="size-5 rounded-md"
        />
      ) : null}

      {detail.mcpServers.length > 0 ? (
        <section>
          <h4 className="text-sm font-semibold text-foreground">{t('resources.plugins.detail.mcpServers')}</h4>
          <ul className="mt-2 space-y-1">
            {detail.mcpServers.map((name) => (
              <li key={name} className="text-sm text-foreground">{name}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {facts.length > 0 || links.length > 0 || detail.capabilities.length > 0 ? (
        <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 text-foreground">{fact.value}</dd>
            </Fragment>
          ))}
          {links.map((link) => (
            <Fragment key={link.label}>
              <dt className="text-muted-foreground">{link.label}</dt>
              <dd className="min-w-0">
                <button
                  type="button"
                  className="max-w-full truncate text-foreground underline-offset-2 hover:underline"
                  onClick={() => requestOpenExternalLink(link.href)}
                >
                  {linkHost(link.href)}
                </button>
              </dd>
            </Fragment>
          ))}
          {detail.capabilities.length > 0 ? (
            <Fragment>
              <dt className="text-muted-foreground">{t('resources.plugins.detail.capabilities')}</dt>
              <dd className="flex min-w-0 flex-wrap gap-1.5">
                {detail.capabilities.map((capability) => (
                  <span key={capability} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{capability}</span>
                ))}
              </dd>
            </Fragment>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}

function PluginResourceList({
  title,
  rows,
  dark,
  iconClassName,
}: {
  title: string
  rows: { id: string; name: string; description: string; iconUrl: string | null; iconUrlDark: string | null }[]
  dark: boolean
  iconClassName: string
}) {
  return (
    <section>
      <h4 aria-label={`${title} ${rows.length}`} className="flex items-baseline gap-2 border-b border-border pb-2 text-base font-semibold text-foreground">
        {title}
        <span aria-hidden="true" className="text-sm font-normal text-muted-foreground">{rows.length}</span>
      </h4>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="flex min-w-0 items-start gap-3 border-b border-border/40 py-3">
            <ShelfIcon name={row.name} iconUrl={(dark && row.iconUrlDark) || row.iconUrl} className={iconClassName} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
              {row.description ? <p className="truncate text-sm text-muted-foreground">{row.description}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function linkHost(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return href
  }
}

function PluginRowAction({
  card,
  remote,
  busyId,
  onInstall,
  onUninstall,
}: {
  card: CodexPluginShelfCard
  remote: boolean
  busyId: string | null
  onInstall: (card: CodexPluginShelfCard) => void
  onUninstall: (card: CodexPluginShelfCard) => void
}) {
  const { t } = useTranslation()
  const busy = busyId === card.id
  if (card.installed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t('resources.plugins.pluginActions', { name: card.name })} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!card.installedKey || busy} onClick={() => onUninstall(card)}>
            {t('resources.plugins.uninstallPlugin')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  if (card.install && !remote) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={t('resources.plugins.installNamed', { name: card.name })}
        disabled={busy}
        onClick={() => onInstall(card)}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label={remote ? t('resources.plugins.remoteInstallUnavailable') : t('resources.plugins.unavailableNamed', { name: card.name })}
      disabled
    >
      <UserRound className="size-4" />
    </Button>
  )
}

function useCachedRemoteImage(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!url) {
      setSrc(null)
      return
    }
    void window.app.cacheRemoteImage(url).then((cached) => {
      if (!cancelled) setSrc(cached ?? url)
    }).catch(() => {
      if (!cancelled) setSrc(url)
    })
    return () => { cancelled = true }
  }, [url])
  return src
}

function ShelfIcon({ name, iconUrl, className }: { name: string; iconUrl: string | null; className?: string }) {
  const src = useCachedRemoteImage(iconUrl)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [iconUrl])

  if (!src || failed) {
    return (
      <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground uppercase', className)}>
        {name.slice(0, 1)}
      </div>
    )
  }
  return <img src={src} alt="" className={cn('size-8 shrink-0 rounded-lg object-cover', className)} onError={() => setFailed(true)} />
}

function DetailScreenshot({ url }: { url: string }) {
  const src = useCachedRemoteImage(url)
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      src={src}
      alt=""
      className="h-28 w-44 shrink-0 rounded-md bg-muted object-cover"
      onError={() => setFailed(true)}
    />
  )
}
