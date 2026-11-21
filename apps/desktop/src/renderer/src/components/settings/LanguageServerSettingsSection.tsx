import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Globe, Loader2, Pencil, Plus, RefreshCw, Search, Square, Star, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { GithubIcon } from '@superone/ui/components/ui/github-icon'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import type { CustomLspServerConfig, LspLanguageStat, LspServerInfo } from '@superone/shared/desktop-lsp'
import { getLanguageColor, getServerPriorityRank } from '@superone/shared/lsp-languages'
import { BrowserFavicon } from '@/components/browser/BrowserFavicon'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { formatStarCount } from '@/lib/format-star-count'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { settingsSelectTriggerClassName } from './select-trigger-class'
import { SettingsRow, SettingsSection } from './SettingsSection'

const PREVIEW_LIMIT = 20

function formatLangLabel(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    swift: 'Swift',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    cpp: 'C++',
    c: 'C',
    sql: 'SQL',
    bash: 'Shell',
    mdx: 'MDX',
  }
  return map[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1)
}

export function LanguageServerSettingsSection() {
  const { t } = useTranslation()
  const effectiveRoot = useEffectiveProjectRoot()
  const setLspServerEnabledBatch = useAppStore((s) => s.setLspServerEnabledBatch)
  const upsertCustomLspServer = useAppStore((s) => s.upsertCustomLspServer)
  const removeCustomLspServer = useAppStore((s) => s.removeCustomLspServer)

  const [detectedStats, setDetectedStats] = useState<LspLanguageStat[]>([])
  const [preferredServers, setPreferredServers] = useState<string[]>([])
  const [servers, setServers] = useState<LspServerInfo[]>([])
  const [registryServers, setRegistryServers] = useState<LspServerInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingRegistry, setLoadingRegistry] = useState(false)
  const [starsMap, setStarsMap] = useState<Record<string, number>>({})
  const [hasGh, setHasGh] = useState<boolean | null>(null)
  const [loadingStars, setLoadingStars] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const registryRequestedRef = useRef(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [customLabel, setCustomLabel] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customArgs, setCustomArgs] = useState('--stdio')
  const [customLanguages, setCustomLanguages] = useState('')

  const refresh = useCallback(async () => {
    try {
      const list = await window.app.listLspServers()
      setServers(list)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRegistry = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && registryRequestedRef.current) return
    registryRequestedRef.current = true
    setLoadingRegistry(true)
    try {
      const list = await window.app.fetchLspRegistry?.(forceRefresh)
      if (Array.isArray(list)) {
        setRegistryServers(list)
      }
    } catch (err) {
      registryRequestedRef.current = false
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingRegistry(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void loadRegistry(false)
    const unsubscribe = window.app.onLspStatusChange(() => {
      void refresh()
      if (registryRequestedRef.current) {
        void window.app.fetchLspRegistry?.(false).then((list) => {
          if (Array.isArray(list)) setRegistryServers(list)
        }).catch(() => {})
      }
    })
    return unsubscribe
  }, [refresh, loadRegistry])

  useEffect(() => {
    if (!effectiveRoot) {
      setDetectedStats([])
      setPreferredServers([])
      return
    }
    let cancelled = false
    void window.app.detectProjectLspLanguages?.(effectiveRoot).then((detection) => {
      if (!cancelled && detection) {
        setDetectedStats(Array.isArray(detection.languages) ? detection.languages : [])
        setPreferredServers(Array.isArray(detection.preferredServers) ? detection.preferredServers : [])
      }
    }).catch(() => {
      if (!cancelled) {
        setDetectedStats([])
        setPreferredServers([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [effectiveRoot])

  const ratioByLang = useMemo(
    () => new Map(detectedStats.map((s) => [s.language, s.ratio])),
    [detectedStats],
  )
  const preferredSet = useMemo(() => new Set(preferredServers), [preferredServers])

  const languageBreakdown = useMemo(() => {
    const major = detectedStats.filter((s) => s.ratio >= 0.002).slice(0, 8)
    const majorSum = major.reduce((sum, s) => sum + s.ratio, 0)
    const otherRatio = Math.max(0, 1 - majorSum)
    const items = major.map((s) => ({
      key: s.language,
      label: formatLangLabel(s.language),
      ratio: s.ratio,
      color: getLanguageColor(s.language),
    }))
    if (major.length > 0 && otherRatio >= 0.002) {
      items.push({
        key: '__other__',
        label: 'Other',
        ratio: otherRatio,
        color: '#8b949e',
      })
    }
    return items
  }, [detectedStats])

  const sourceList = registryServers ?? servers

  const serverMatchRatio = useCallback(
    (server: LspServerInfo) => {
      let sum = 0
      for (const lang of server.languages) {
        sum += ratioByLang.get(lang) ?? 0
      }
      return sum
    },
    [ratioByLang],
  )

  const getServerRank = useCallback(
    (server: LspServerInfo) => {
      if (server.custom) return 120
      return getServerPriorityRank(server.id) + (preferredSet.has(server.id) ? 40 : 0)
    },
    [preferredSet],
  )

  const sortedBase = useMemo(() => {
    return [...sourceList].sort((a, b) => {
      const aRank = getServerRank(a)
      const bRank = getServerRank(b)
      const aWeighted = aRank <= 10 ? 0 : serverMatchRatio(a) * aRank
      const bWeighted = bRank <= 10 ? 0 : serverMatchRatio(b) * bRank
      if (Math.abs(bWeighted - aWeighted) > 0.05) return bWeighted - aWeighted
      const aState = (a.custom ? 8 : 0) + (a.installStatus === 'installed' ? 4 : 0) + (a.enabled ? 2 : 0) + (a.installable ? 1 : 0)
      const bState = (b.custom ? 8 : 0) + (b.installStatus === 'installed' ? 4 : 0) + (b.enabled ? 2 : 0) + (b.installable ? 1 : 0)
      if (bState !== aState) return bState - aState
      if (bRank !== aRank) return bRank - aRank
      if ((b.githubStars ?? 0) !== (a.githubStars ?? 0)) {
        return (b.githubStars ?? 0) - (a.githubStars ?? 0)
      }
      return a.label.localeCompare(b.label)
    })
  }, [sourceList, serverMatchRatio, getServerRank])

  const recommendedIds = useMemo(() => {
    const picked = new Set<string>()
    for (const stat of detectedStats) {
      if (stat.ratio < 0.01) continue
      const candidates = sortedBase.filter(
        (s) => getServerRank(s) > 10 && s.languages.includes(stat.language),
      )
      if (candidates.length === 0) continue
      const best = [...candidates].sort((a, b) => {
        const aAffinity =
          getServerRank(a) +
          (a.id === stat.language || a.id.includes(stat.language) ? 50 : 0) +
          (a.installStatus === 'installed' ? 20 : 0)
        const bAffinity =
          getServerRank(b) +
          (b.id === stat.language || b.id.includes(stat.language) ? 50 : 0) +
          (b.installStatus === 'installed' ? 20 : 0)
        return bAffinity - aAffinity
      })[0]
      if (best && (getServerRank(best) >= 30 || best.id.includes(stat.language))) {
        picked.add(best.id)
      }
    }
    return picked
  }, [detectedStats, sortedBase, getServerRank])

  const filteredServers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hasProjectLangs = detectedStats.length > 0
    const matches = q
      ? sortedBase.filter(
          (server) =>
            server.label.toLowerCase().includes(q) ||
            server.serverName.toLowerCase().includes(q) ||
            server.id.toLowerCase().includes(q) ||
            (server.description?.toLowerCase().includes(q) ?? false) ||
            server.languages.some((lang) => lang.toLowerCase().includes(q)),
        )
      : hasProjectLangs
        ? sortedBase.filter(
            (server) =>
              server.custom ||
              server.enabled ||
              (getServerRank(server) > 10 &&
                server.languages.some((lang) => ratioByLang.has(lang))),
          )
        : sortedBase

    if (q) return matches
    return [...matches].sort((a, b) => {
      const aRec = recommendedIds.has(a.id) ? 1 : 0
      const bRec = recommendedIds.has(b.id) ? 1 : 0
      if (bRec !== aRec) return bRec - aRec
      return 0
    })
  }, [sortedBase, query, recommendedIds, detectedStats.length, getServerRank, ratioByLang])

  const visibleServers = useMemo(() => {
    if (!query.trim() && filteredServers.length > PREVIEW_LIMIT) {
      return filteredServers.slice(0, PREVIEW_LIMIT)
    }
    return filteredServers
  }, [query, filteredServers])

  useEffect(() => {
    if (hasGh === false) return
    const missing = Array.from(
      new Set(
        visibleServers
          .map((s) => s.githubRepo)
          .filter((repo): repo is string => Boolean(repo && starsMap[repo] === undefined)),
      ),
    )
    if (missing.length === 0) return
    let cancelled = false
    setLoadingStars(true)
    void window.app
      .fetchLspGithubStars?.(missing)
      .then((res) => {
        if (cancelled || !res) return
        setHasGh(res.hasGh)
        if (res.hasGh && res.stars) {
          setStarsMap((prev) => ({ ...prev, ...res.stars }))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingStars(false)
      })
    return () => {
      cancelled = true
    }
  }, [visibleServers, starsMap, hasGh])

  function updateServerInLists(updated: LspServerInfo) {
    setServers((prev) => {
      const idx = prev.findIndex((s) => s.id === updated.id)
      if (idx >= 0) return prev.map((s) => (s.id === updated.id ? updated : s))
      return updated.installStatus === 'installed' ? [...prev, updated] : prev
    })
    setRegistryServers((prev) =>
      prev ? prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) : prev,
    )
  }

  async function handleServerToggle(server: LspServerInfo, enabled: boolean) {
    const patch: Record<string, boolean> = { [server.id]: enabled }
    const disabledConflicts: LspServerInfo[] = []

    if (enabled && server.languages.length > 0) {
      const langSet = new Set(server.languages)
      const storeEnabled = useAppStore.getState().lspEnabledServers
      for (const other of sourceList) {
        const otherEnabled = storeEnabled[other.id] ?? other.enabled
        if (other.id !== server.id && otherEnabled && other.languages.some((l) => langSet.has(l))) {
          patch[other.id] = false
          disabledConflicts.push(other)
        }
      }
    }

    await setLspServerEnabledBatch(patch)

    const cmLsp = await import('../coding/cm-lsp').catch(() => null)
    if (!enabled && effectiveRoot) {
      cmLsp?.disposeLspClient(server.id, effectiveRoot)
      await window.app.stopLspWorkspace(server.id, effectiveRoot)
    }
    for (const conflict of disabledConflicts) {
      if (effectiveRoot) {
        cmLsp?.disposeLspClient(conflict.id, effectiveRoot)
        await window.app.stopLspWorkspace(conflict.id, effectiveRoot)
      }
    }

    setServers((prev) =>
      prev.map((s) => (s.id in patch ? { ...s, enabled: patch[s.id] } : s)),
    )
    setRegistryServers((prev) =>
      prev ? prev.map((s) => (s.id in patch ? { ...s, enabled: patch[s.id] } : s)) : prev,
    )

    if (disabledConflicts.length > 0) {
      toast.success(
        t('settings.editor.lsp.serverReplaced', {
          name: server.label,
          disabled: disabledConflicts.map((c) => c.label).join(', '),
        }),
      )
    } else {
      toast.success(
        t(enabled ? 'settings.editor.lsp.serverEnabled' : 'settings.editor.lsp.serverDisabled', {
          name: server.label,
        }),
      )
    }
  }

  async function handleInstall(server: LspServerInfo) {
    setBusyId(server.id)
    try {
      const updated = await window.app.installLspServer(server.id)
      updateServerInLists(updated)
      if (updated.installStatus === 'installed') {
        toast.success(t('settings.editor.lsp.installSuccess', { name: server.serverName }))
      } else {
        toast.error(t('settings.editor.lsp.installFailed', { name: server.serverName }), {
          description: updated.installError ?? undefined,
        })
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleUninstall(server: LspServerInfo) {
    setBusyId(server.id)
    try {
      const updated = await window.app.uninstallLspServer(server.id)
      updateServerInLists(updated)
      toast.success(t('settings.editor.lsp.uninstallSuccess', { name: server.serverName }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleStopProject(server: LspServerInfo) {
    if (!effectiveRoot) return
    const cmLsp = await import('../coding/cm-lsp').catch(() => null)
    cmLsp?.disposeLspClient(server.id, effectiveRoot)
    await window.app.stopLspWorkspace(server.id, effectiveRoot)
    await refresh()
    toast.success(t('settings.editor.lsp.stoppedToast', { name: server.serverName }))
  }

  function openAddDialog() {
    setEditingId(null)
    setCustomLabel('')
    setCustomCommand('')
    setCustomArgs('--stdio')
    setCustomLanguages('')
    setDialogOpen(true)
  }

  function openEditDialog(server: LspServerInfo) {
    setEditingId(server.id)
    setCustomLabel(server.label)
    setCustomCommand(server.command ?? server.serverName)
    setCustomArgs((server.args ?? ['--stdio']).join(' '))
    setCustomLanguages(server.languages.join(', '))
    setDialogOpen(true)
  }

  async function handleSaveCustom() {
    const label = customLabel.trim()
    const command = customCommand.trim()
    if (!label || !command) return
    const args = customArgs.trim() ? customArgs.trim().split(/\s+/) : []
    const languages = customLanguages
      .split(',')
      .map((s) => s.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean)

    const config: CustomLspServerConfig = {
      id: editingId ?? `custom:${Date.now()}`,
      label,
      command,
      args,
      languages,
    }
    await upsertCustomLspServer(config)
    setDialogOpen(false)
    await refresh()
    if (registryRequestedRef.current) {
      void loadRegistry(true)
    }
  }

  async function handleDeleteCustom(server: LspServerInfo) {
    if (effectiveRoot) {
      const cmLsp = await import('../coding/cm-lsp').catch(() => null)
      cmLsp?.disposeLspClient(server.id, effectiveRoot)
      await window.app.stopLspWorkspace(server.id, effectiveRoot)
    }
    await removeCustomLspServer(server.id)
    setServers((prev) => prev.filter((s) => s.id !== server.id))
    setRegistryServers((prev) => (prev ? prev.filter((s) => s.id !== server.id) : prev))
  }

  return (
    <SettingsSection title={t('settings.editor.lsp.title')}>
      <div className="border-b border-border/60 px-3 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium">{t('settings.editor.lsp.projectLabel')}</div>
          <ProjectSelector
            align="end"
            triggerClassName={cn(settingsSelectTriggerClassName, 'gap-2 py-0')}
          />
        </div>
        {!effectiveRoot ? (
          <div className="mt-1.5 text-xs text-muted-foreground">{t('settings.editor.lsp.noProject')}</div>
        ) : languageBreakdown.length === 0 ? (
          <div className="mt-1.5 text-xs text-muted-foreground">{t('settings.editor.lsp.noDetectedLanguages')}</div>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {languageBreakdown.map((item) => (
                <div
                  key={item.key}
                  style={{ width: `${Math.max(item.ratio * 100, 0.5)}%`, backgroundColor: item.color }}
                  title={`${item.label} ${(item.ratio * 100).toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {languageBreakdown.map((item) => {
                const pct = item.ratio * 100
                const pctText = pct >= 1 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
                return (
                  <span key={item.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-medium text-foreground">{item.label}</span>
                    <span className="text-muted-foreground">{pctText}</span>
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.editor.lsp.searchPlaceholder')}
            className="h-8 pr-7 pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 text-xs"
          onClick={openAddDialog}
        >
          <Plus className="size-3.5" />
          {t('settings.editor.lsp.addCustom')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          title={t('settings.editor.lsp.refreshRegistry')}
          disabled={loadingRegistry}
          onClick={() => void loadRegistry(true)}
        >
          <RefreshCw className={cn('size-3.5', loadingRegistry && 'animate-spin')} />
        </Button>
      </div>

      {loading ? (
        <SettingsRow label={t('settings.editor.lsp.loading')}>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </SettingsRow>
      ) : visibleServers.length === 0 ? (
        <SettingsRow label={t('settings.editor.lsp.noMatches')} />
      ) : (
        <>
          {visibleServers.map((server) => {
            const stars =
              server.githubRepo && starsMap[server.githubRepo] !== undefined
                ? starsMap[server.githubRepo]
                : server.githubStars
            const isBusy = busyId === server.id || server.installStatus === 'installing'
            const isRecommended = recommendedIds.has(server.id)
            const isRunningInProject = Boolean(
              effectiveRoot && server.runningWorkspaces.some((w) => w.workspaceRoot === effectiveRoot),
            )
            const statusText =
              server.installStatus === 'installing'
                ? t('settings.editor.lsp.installing')
                : server.installStatus === 'installed'
                  ? server.version
                    ? t('settings.editor.lsp.installed', { version: server.version })
                    : t('settings.editor.lsp.installedSystem')
                  : server.installStatus === 'error'
                    ? server.installError ?? t('settings.editor.lsp.notInstalled')
                    : !server.installable && server.installHint
                      ? t('settings.editor.lsp.manualInstall', { cmd: server.installHint })
                      : t('settings.editor.lsp.notInstalled')

            const runningBadge =
              server.runningWorkspaces.length > 0
                ? ` · ${t('settings.editor.lsp.running', { count: server.runningWorkspaces.length })}`
                : ''

            return (
              <SettingsRow
                key={server.id}
                label={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{server.label}</span>
                    {server.custom && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t('settings.editor.lsp.customBadge')}
                      </span>
                    )}
                    {isRecommended && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {t('settings.editor.lsp.recommendedBadge')}
                      </span>
                    )}
                    {server.languages.length > 0 && (
                      <span className="font-mono text-[11px] font-normal text-muted-foreground">
                        {server.languages.slice(0, 5).join(', ')}
                      </span>
                    )}
                  </span>
                }
                description={
                  <span className="flex flex-col gap-0.5">
                    {server.githubRepo ? (
                      <button
                        type="button"
                        onClick={() => void window.app.openExternalLink(`https://github.com/${server.githubRepo}`)}
                        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <GithubIcon className="size-3 shrink-0" />
                        <span className="truncate">{server.githubRepo}</span>
                        {stars != null ? (
                          <span className="inline-flex shrink-0 items-center gap-0.5">
                            <Star className="size-3 shrink-0" />
                            {formatStarCount(stars)}
                          </span>
                        ) : loadingStars && hasGh !== false ? (
                          <Loader2 className="size-2.5 shrink-0 animate-spin text-muted-foreground/70" />
                        ) : null}
                      </button>
                    ) : server.homepage ? (
                      <button
                        type="button"
                        onClick={() => void window.app.openExternalLink(server.homepage!)}
                        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <BrowserFavicon
                          url={server.homepage}
                          className="size-3 shrink-0 rounded-xs"
                          fallback={<Globe className="size-3 shrink-0" />}
                        />
                        <span className="truncate">
                          {server.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </span>
                      </button>
                    ) : null}
                    <span>
                      {server.description
                        ? `${server.description} · ${statusText}${runningBadge}`
                        : `${server.serverName} · ${statusText}${runningBadge}`}
                    </span>
                  </span>
                }
              >
                <div className="flex items-center gap-2">
                  {isRunningInProject && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      onClick={() => void handleStopProject(server)}
                    >
                      <Square className="size-3" />
                      {t('settings.editor.lsp.stop')}
                    </Button>
                  )}

                  {server.custom ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditDialog(server)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDeleteCustom(server)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : server.installStatus !== 'installed' ? (
                    server.installable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1"
                        disabled={isBusy}
                        onClick={() => void handleInstall(server)}
                      >
                        {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                        {isBusy ? t('settings.editor.lsp.installing') : t('settings.editor.lsp.install')}
                      </Button>
                    )
                  ) : (
                    server.managed && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-muted-foreground hover:text-destructive"
                        disabled={isBusy}
                        onClick={() => void handleUninstall(server)}
                      >
                        <Trash2 className="size-3" />
                        {t('settings.editor.lsp.uninstall')}
                      </Button>
                    )
                  )}

                  <Switch
                    aria-label={server.label}
                    checked={server.enabled}
                    onCheckedChange={(checked) => void handleServerToggle(server, checked)}
                  />
                </div>
              </SettingsRow>
            )
          })}
          {visibleServers.length < filteredServers.length && (
            <div className="px-4 py-2 text-center text-xs text-muted-foreground">
              {t('settings.editor.lsp.showingSubset', {
                shown: visibleServers.length,
                total: filteredServers.length,
              })}
            </div>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('settings.editor.lsp.editCustom') : t('settings.editor.lsp.addCustom')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lsp-custom-name">{t('settings.editor.lsp.customName')}</Label>
              <Input
                id="lsp-custom-name"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="My DSL LSP"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lsp-custom-cmd">{t('settings.editor.lsp.customCommand')}</Label>
              <Input
                id="lsp-custom-cmd"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder="/usr/local/bin/my-lsp"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lsp-custom-args">{t('settings.editor.lsp.customArgs')}</Label>
              <Input
                id="lsp-custom-args"
                value={customArgs}
                onChange={(e) => setCustomArgs(e.target.value)}
                placeholder="--stdio"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lsp-custom-langs">{t('settings.editor.lsp.customLanguages')}</Label>
              <Input
                id="lsp-custom-langs"
                value={customLanguages}
                onChange={(e) => setCustomLanguages(e.target.value)}
                placeholder="dsl, .myext"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('settings.editor.lsp.customCancel')}
            </Button>
            <Button
              disabled={!customLabel.trim() || !customCommand.trim()}
              onClick={() => void handleSaveCustom()}
            >
              <Check className="mr-1.5 size-3.5" />
              {t('settings.editor.lsp.customSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
