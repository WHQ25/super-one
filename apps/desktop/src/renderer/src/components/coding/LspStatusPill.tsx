import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RotateCw, Settings2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import {
  getLspClientStatus,
  getLspRestartVersion,
  getLspStatusVersion,
  resolveEnabledLspServer,
  resolveEnabledLspServersForFiles,
  restartLspWorkspace,
  subscribeLspClientStatus,
  subscribeLspRestart,
  type LspClientPhase,
  type ResolvedLspServer,
} from '@/lib/lsp-status-store'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { inferLanguage } from '@/lib/shiki-highlighter'
import { useAppStore } from '@/stores/app'

export type LspIndicatorPhase = 'unconfigured' | 'idle' | LspClientPhase

export interface LspServerStatusEntry {
  server: ResolvedLspServer
  phase: Exclude<LspIndicatorPhase, 'unconfigured'>
  error: string | null
}

export interface LspStatusPillProps {
  workspaceRoot?: string | null
  filePath?: string
  filePaths?: readonly string[]
  language?: string | null
  variant?: 'editor' | 'review'
  enabled?: boolean
  className?: string
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between gap-4 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="font-mono text-[10px] text-foreground">{keys}</kbd>
    </div>
  )
}

function StatusDot({
  phase,
  spinning = false,
}: {
  phase: LspIndicatorPhase
  spinning?: boolean
}) {
  if (spinning || phase === 'starting' || phase === 'indexing') {
    return <Loader2 className="size-2.5 shrink-0 animate-spin text-amber-500" />
  }
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        phase === 'ready' && 'bg-emerald-500',
        phase === 'error' && 'bg-rose-500',
        (phase === 'unconfigured' || phase === 'idle') && 'bg-muted-foreground/40',
      )}
    />
  )
}

function phaseBadgeClass(phase: LspIndicatorPhase): string {
  if (phase === 'ready') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  if (phase === 'starting' || phase === 'indexing') {
    return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  }
  if (phase === 'error') return 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
  return 'bg-muted text-muted-foreground'
}

export function useLspIndicatorState({
  workspaceRoot,
  filePath,
  filePaths,
  language,
  variant = 'editor',
  enabled = true,
}: {
  workspaceRoot?: string | null
  filePath?: string
  filePaths?: readonly string[]
  language?: string | null
  variant?: 'editor' | 'review'
  enabled?: boolean
}): {
  supported: boolean
  phase: LspIndicatorPhase
  entries: LspServerStatusEntry[]
  error: string | null
} {
  const lspEnabledServers = useAppStore((s) => s.lspEnabledServers)
  const customLspServers = useAppStore((s) => s.customLspServers)
  const [matchedServers, setMatchedServers] = useState<ResolvedLspServer[]>([])
  const [ipcTick, setIpcTick] = useState(0)

  const filePathsKey = useMemo(
    () => (filePaths ? filePaths.join('\0') : filePath ?? ''),
    [filePaths, filePath],
  )

  const hasCodeTarget = useMemo(() => {
    if (filePaths) {
      return filePaths.some((p) => inferLanguage(p) !== 'text')
    }
    return Boolean(filePath && language !== 'text')
  }, [filePaths, filePath, language])

  const supported = Boolean(
    enabled &&
      workspaceRoot &&
      !parseRemoteProjectKey(workspaceRoot) &&
      hasCodeTarget,
  )

  useSyncExternalStore(
    subscribeLspClientStatus,
    getLspStatusVersion,
    getLspStatusVersion,
  )

  const restartTick = useSyncExternalStore(
    subscribeLspRestart,
    getLspRestartVersion,
    getLspRestartVersion,
  )

  useEffect(() => {
    const unsubIpc =
      typeof window.app?.onLspStatusChange === 'function'
        ? window.app.onLspStatusChange(() => setIpcTick((v) => v + 1))
        : () => {}
    return () => {
      unsubIpc()
    }
  }, [])

  useEffect(() => {
    if (!supported) {
      setMatchedServers([])
      return
    }
    let cancelled = false
    const resolvePromise = filePaths
      ? resolveEnabledLspServersForFiles(filePaths, workspaceRoot)
      : filePath
        ? resolveEnabledLspServer(filePath, language).then((res) => (res ? [res] : []))
        : Promise.resolve([])

    void resolvePromise
      .then((resolved) => {
        if (!cancelled) setMatchedServers(resolved)
      })
      .catch(() => {
        if (!cancelled) setMatchedServers([])
      })
    return () => {
      cancelled = true
    }
  }, [
    supported,
    filePathsKey,
    filePath,
    language,
    workspaceRoot,
    lspEnabledServers,
    customLspServers,
    ipcTick,
    restartTick,
  ])

  if (!supported) {
    return { supported: false, phase: 'unconfigured', entries: [], error: null }
  }

  if (matchedServers.length === 0 || !workspaceRoot) {
    return { supported: true, phase: 'unconfigured', entries: [], error: null }
  }

  const defaultPhase: Exclude<LspIndicatorPhase, 'unconfigured'> =
    variant === 'review' ? 'idle' : 'starting'

  const entries: LspServerStatusEntry[] = matchedServers.map((server) => {
    const status = getLspClientStatus(server.serverId, workspaceRoot)
    return {
      server,
      phase: status?.phase ?? defaultPhase,
      error: status?.error ?? null,
    }
  })

  const phase: LspIndicatorPhase = entries.some((e) => e.phase === 'error')
    ? 'error'
    : entries.some((e) => e.phase === 'starting')
      ? 'starting'
      : entries.some((e) => e.phase === 'indexing')
        ? 'indexing'
        : entries.some((e) => e.phase === 'ready')
          ? 'ready'
          : 'idle'

  const firstError = entries.find((e) => e.phase === 'error')?.error ?? null

  return {
    supported: true,
    phase,
    entries,
    error: firstError,
  }
}

export function LspStatusPill({
  workspaceRoot,
  filePath,
  filePaths,
  language,
  variant = 'editor',
  enabled = true,
  className,
}: LspStatusPillProps) {
  const { t } = useTranslation()
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const [open, setOpen] = useState(false)
  const [restartingIds, setRestartingIds] = useState<Record<string, boolean>>({})

  const state = useLspIndicatorState({
    workspaceRoot,
    filePath,
    filePaths,
    language,
    variant,
    enabled,
  })

  if (!state.supported) return null

  const lspLabel = t('settings.editor.lsp.indicatorLabel')

  const labelForPhase = (phase: LspIndicatorPhase): string => {
    if (phase === 'ready') return t('settings.editor.lsp.statusReady')
    if (phase === 'indexing') return t('settings.editor.lsp.statusIndexing')
    if (phase === 'starting') return t('settings.editor.lsp.statusStarting')
    if (phase === 'error') return t('settings.editor.lsp.statusError')
    if (phase === 'idle') return t('settings.editor.lsp.statusIdle')
    return t('settings.editor.lsp.statusUnconfigured')
  }

  const singleEntry = state.entries.length === 1 ? state.entries[0] : null
  const multiEntries = state.entries.length > 1 ? state.entries : null
  const primaryServer = singleEntry?.server ?? null
  const serverDisplayName =
    primaryServer?.serverName || primaryServer?.serverLabel || primaryServer?.serverId || null
  const serverTitle = primaryServer?.serverLabel || serverDisplayName || lspLabel
  const detailName = serverDisplayName ?? lspLabel
  const statusLabel = labelForPhase(state.phase)

  const statusDetail =
    state.phase === 'unconfigured'
      ? t('settings.editor.lsp.statusNoServer')
      : multiEntries
        ? t('settings.editor.lsp.multipleServersDetail', { count: multiEntries.length })
        : state.phase === 'idle'
          ? t('settings.editor.lsp.statusIdleDetail', { name: detailName })
          : state.phase === 'starting'
            ? t('settings.editor.lsp.statusStartingDetail', { name: detailName })
            : state.phase === 'indexing'
              ? t('settings.editor.lsp.statusIndexingDetail', { name: detailName })
              : state.phase === 'ready'
                ? t('settings.editor.lsp.statusReadyDetail', { name: detailName })
                : state.error || t('settings.editor.lsp.statusErrorDetail', { name: detailName })

  const mac = isMacPlatform()
  const anyRestarting = Object.values(restartingIds).some(Boolean)

  const tooltipText = multiEntries
    ? `${multiEntries.map((e) => e.server.serverName || e.server.serverId).join(', ')} · ${statusLabel}`
    : `${serverDisplayName ?? lspLabel} · ${statusLabel}`

  const handleOpenSettings = () => {
    setOpen(false)
    setSettingsTab('editor')
    navigateTo('settings')
  }

  const handleRestartServer = async (serverId: string) => {
    if (!workspaceRoot || restartingIds[serverId]) return
    setRestartingIds((prev) => ({ ...prev, [serverId]: true }))
    try {
      await restartLspWorkspace(serverId, workspaceRoot)
    } finally {
      setRestartingIds((prev) => ({ ...prev, [serverId]: false }))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="lsp-status-pill"
          data-lsp-phase={state.phase}
          title={tooltipText}
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium transition-colors hover:bg-muted',
            state.phase === 'ready' && 'text-foreground/85 hover:text-foreground',
            (state.phase === 'starting' || state.phase === 'indexing') &&
              'text-muted-foreground hover:text-foreground',
            state.phase === 'error' && 'text-rose-600 dark:text-rose-400',
            (state.phase === 'unconfigured' || state.phase === 'idle') &&
              'text-muted-foreground hover:text-foreground',
            className,
          )}
        >
          <StatusDot phase={state.phase} spinning={anyRestarting} />
          <span>{lspLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-76 p-3 text-xs">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
              <StatusDot phase={state.phase} spinning={anyRestarting} />
              <span className="truncate">{serverTitle}</span>
            </div>
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', phaseBadgeClass(state.phase))}>
              {statusLabel}
            </span>
          </div>

          <p className="break-words text-[11px] leading-relaxed text-muted-foreground">
            {statusDetail}
          </p>

          {multiEntries && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
              {multiEntries.map((entry) => {
                const name = entry.server.serverLabel || entry.server.serverName || entry.server.serverId
                const busy = Boolean(restartingIds[entry.server.serverId])
                return (
                  <div key={entry.server.serverId} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <StatusDot phase={entry.phase} spinning={busy} />
                      <span className="truncate text-[11px] font-medium text-foreground" title={entry.error ?? name}>
                        {name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', phaseBadgeClass(entry.phase))}>
                        {labelForPhase(entry.phase)}
                      </span>
                      {workspaceRoot && entry.phase !== 'idle' && (
                        <button
                          type="button"
                          aria-label={`${t('settings.editor.lsp.restartAction')} ${name}`}
                          title={t('settings.editor.lsp.restartAction')}
                          disabled={busy}
                          onClick={() => void handleRestartServer(entry.server.serverId)}
                          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          <RotateCw className={cn('size-3', busy && 'animate-spin')} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {state.phase !== 'unconfigured' && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 text-[11px]">
              <ShortcutRow
                label={t('settings.editor.lsp.shortcutHover')}
                keys={mac ? t('settings.editor.lsp.shortcutHoverKeysMac') : t('settings.editor.lsp.shortcutHoverKeysOther')}
              />
              <ShortcutRow
                label={t('settings.editor.lsp.shortcutDefinition')}
                keys={
                  mac
                    ? t('settings.editor.lsp.shortcutDefinitionKeysMac')
                    : t('settings.editor.lsp.shortcutDefinitionKeysOther')
                }
              />
              {variant === 'editor' && (
                <>
                  <ShortcutRow
                    label={t('settings.editor.lsp.shortcutAutocomplete')}
                    keys={t('settings.editor.lsp.shortcutAutocompleteKeys')}
                  />
                  <ShortcutRow
                    label={t('settings.editor.lsp.shortcutRename')}
                    keys={t('settings.editor.lsp.shortcutRenameKeys')}
                  />
                  <ShortcutRow
                    label={t('settings.editor.lsp.shortcutFormat')}
                    keys={t('settings.editor.lsp.shortcutFormatKeys')}
                  />
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-1.5 pt-0.5">
            {singleEntry && workspaceRoot && singleEntry.phase !== 'idle' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={Boolean(restartingIds[singleEntry.server.serverId])}
                onClick={() => void handleRestartServer(singleEntry.server.serverId)}
              >
                <RotateCw
                  className={cn('size-3', restartingIds[singleEntry.server.serverId] && 'animate-spin')}
                />
                {t('settings.editor.lsp.restartAction')}
              </Button>
            )}
            <Button
              type="button"
              variant={state.phase === 'unconfigured' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={handleOpenSettings}
            >
              <Settings2 className="size-3" />
              {t('settings.editor.lsp.openSettingsAction')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
