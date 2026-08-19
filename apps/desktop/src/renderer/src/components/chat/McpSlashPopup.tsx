import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, LogIn, RefreshCw, Settings2, X } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import type { McpServerInfo, McpServerMeta } from '@superone/shared/agent-types'
import type { McpbInstalledEntry } from '@superone/shared/mcpb-types'

function ServerIcon({ name, meta, bundle }: { name: string; meta?: McpServerMeta; bundle?: McpbInstalledEntry }) {
  const src = meta?.icons?.[0]?.src ?? bundle?.iconDataUrl
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="size-7 shrink-0 rounded-full bg-muted object-cover"
      />
    )
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase text-muted-foreground ring-1 ring-border">
      {name[0]}
    </div>
  )
}

type Mode = 'live' | 'probe' | 'empty'

interface State {
  mode: Mode
  servers: McpServerInfo[]
  meta: Record<string, McpServerMeta>
  loading: boolean
  error?: string
}

const STATUS_DOT: Record<McpServerInfo['status'], string> = {
  connected: 'bg-success',
  pending: 'bg-warning',
  'needs-auth': 'bg-warning',
  failed: 'bg-error',
  disabled: 'bg-muted-foreground/40',
}

function statusLabel(server: McpServerInfo, t: (k: string, p?: Record<string, unknown>) => string): string {
  switch (server.status) {
    case 'connected':
      return t('resources.mcp.toolsCount', { count: server.toolCount ?? server.tools?.length ?? 0 })
    case 'pending':
      return t('resources.mcp.statusConnecting')
    case 'needs-auth':
      return t('resources.mcp.statusFailed')
    case 'failed':
      return t('resources.mcp.statusFailed')
    case 'disabled':
      return t('resources.mcp.statusDisabled')
  }
}

export function McpSlashPopup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const activeProject = useChatStore((s) => s.activeProject)
  const harness = useActiveSession((s) => s.sessionProvider ?? s.preferredProvider)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const setSettingsProvider = useAppStore((s) => s.setSettingsProvider)

  const [state, setState] = useState<State>({ mode: 'empty', servers: [], meta: {}, loading: true })
  const [bundles, setBundles] = useState<McpbInstalledEntry[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [authenticatingServer, setAuthenticatingServer] = useState<string | null>(null)

  const bundlesByName = useMemo(() => {
    const map: Record<string, McpbInstalledEntry> = {}
    for (const entry of bundles) {
      if (!map[entry.meta.name]) map[entry.meta.name] = entry
    }
    return map
  }, [bundles])

  const load = useCallback(async () => {
    if (!activeProject) {
      setState({ mode: 'empty', servers: [], meta: {}, loading: false })
      return
    }
    const safeListInstalled = async (): Promise<McpbInstalledEntry[]> => {
      try {
        return (await window.app.listInstalledMcpb()) ?? []
      } catch {
        return []
      }
    }
    const safeMetaCache = async (): Promise<Record<string, McpServerMeta>> => {
      try {
        return (await window.app.getMcpMetaCache()) ?? {}
      } catch {
        return {}
      }
    }
    const safeLibrary = async (): Promise<Record<string, McpServerMeta>> => {
      try {
        const entries = (await window.app.listMcpLibrary()) ?? []
        const map: Record<string, McpServerMeta> = {}
        for (const e of entries) {
          if (e.icons && e.icons.length > 0) {
            map[e.name] = { name: e.name, description: e.description, icons: e.icons }
          }
        }
        return map
      } catch {
        return {}
      }
    }
    try {
      const [live, installed, metaCache, libraryMeta] = await Promise.all([
        window.agent.getMcpServerStatus(activeProject),
        safeListInstalled(),
        safeMetaCache(),
        safeLibrary(),
      ])
      const mergedMeta: Record<string, McpServerMeta> = { ...libraryMeta, ...metaCache }
      if (import.meta.env.DEV) {
        console.log('[McpPopup] live server names:', live.map((s) => s.name))
        console.log('[McpPopup] mcpb bundle names:', installed.map((e) => `${e.meta.name} (provider=${e.meta.provider}, hasIcon=${!!e.iconDataUrl})`))
        console.log('[McpPopup] meta cache keys:', Object.keys(metaCache))
        console.log('[McpPopup] library entries with icons:', Object.keys(libraryMeta))
        const liveNames = new Set(live.map((s) => s.name))
        const bundleHit = installed.filter((e) => liveNames.has(e.meta.name)).map((e) => e.meta.name)
        const metaHit = Object.keys(mergedMeta).filter((k) => liveNames.has(k))
        console.log('[McpPopup] bundle name matches:', bundleHit)
        console.log('[McpPopup] meta/library matches:', metaHit)
      }
      setBundles(installed)
      if (live.length > 0) {
        setState({ mode: 'live', servers: live, meta: mergedMeta, loading: false })
        return
      }
      // Not connected: probe the configured servers for THIS harness. Passing the
      // harness is what keeps a Codex session from probing Claude's MCP config (and
      // vice-versa) — the handler reads codex config.toml vs claude config accordingly.
      const probe = await window.app.checkMcpServers(activeProject, harness)
      if (import.meta.env.DEV) {
        console.log('[McpPopup] probe status:', probe.status)
        console.log('[McpPopup] probe meta keys:', Object.keys(probe.meta ?? {}))
      }
      setState({
        mode: probe.status.length > 0 ? 'probe' : 'empty',
        servers: probe.status,
        meta: { ...libraryMeta, ...metaCache, ...(probe.meta ?? {}) },
        loading: false,
      })
    } catch (err) {
      if (import.meta.env.DEV) console.log('[McpPopup] load error:', err)
      const message = err instanceof Error ? err.message : String(err)
      setState({ mode: 'empty', servers: [], meta: {}, loading: false, error: message })
    }
  }, [activeProject, harness])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
      setRefreshing(false)
    } catch (e) {
      setRefreshing(false)
      throw e
    }
  }, [load])

  const handleAuthenticate = useCallback(async (serverName: string) => {
    if (!activeProject) return
    setAuthenticatingServer(serverName)
    setState((current) => ({ ...current, error: undefined }))
    try {
      await window.agent.authenticateMcpServer(activeProject, serverName)
      await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((current) => ({ ...current, error: message }))
    } finally {
      setAuthenticatingServer(null)
    }
  }, [activeProject, load])

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const openMcpSettings = useCallback(() => {
    onClose()
    // Open the MCP settings for THIS session's harness (codex vs claude). Set the
    // provider first — it resets the active tab — then force the mcp tab.
    setSettingsProvider(harness === 'codex' || harness === 'dsh' ? harness : 'claude')
    setSettingsTab('mcp')
    navigateTo('settings')
  }, [onClose, setSettingsProvider, setSettingsTab, navigateTo, harness])

  const banner = useMemo(() => {
    if (state.loading) return ''
    if (state.error) return state.error
    if (state.mode === 'live') {
      const harnessLabel = harness === 'codex' ? 'Codex' : harness === 'opencode' ? 'OpenCode' : 'Claude'
      return t('chat.mcpPopup.liveBadge', { harness: harnessLabel })
    }
    if (state.mode === 'probe') return t('chat.mcpPopup.probeBadge')
    return t('chat.mcpPopup.noActiveSession')
  }, [state.mode, state.loading, state.error, harness, t])

  const bannerTone = state.error
    ? 'text-error'
    : state.mode === 'live'
    ? 'text-success'
    : 'text-muted-foreground'

  return (
    <div className="flex max-h-96 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t('chat.mcpPopup.title')}</span>
          {banner && (
            <span className={cn('truncate text-xs', bannerTone)}>{banner}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || state.loading}
            title={t('chat.mcpPopup.refresh')}
            className={cn(
              'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
              (refreshing || state.loading) && 'text-primary',
            )}
          >
            <RefreshCw className={cn('size-3.5', (refreshing || state.loading) && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => openMcpSettings()}
            title={t('chat.mcpPopup.manageInSettings')}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onClose()}
            title={t('common.close')}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {state.loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : state.servers.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">{t('chat.mcpPopup.empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{t('chat.mcpPopup.emptyHint')}</p>
          </div>
        ) : (
          state.servers.map((server) => {
            const isExpanded = expanded.has(server.name)
            const tools = server.tools ?? []
            const probe = state.mode === 'probe'
            const isError = server.status === 'failed' || server.status === 'needs-auth'
            const hasErrorDetail = isError && !!server.error
            const canExpand = tools.length > 0 || hasErrorDetail
            const canAuthenticate = state.mode === 'live'
              && harness === 'opencode'
              && server.status === 'needs-auth'
            const isAuthenticating = authenticatingServer === server.name
            return (
              <div key={`${server.scope ?? 'local'}:${server.name}`} className="px-1">
                <div className="flex items-center rounded-lg transition-colors hover:bg-muted/50">
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); if (canExpand) toggleExpand(server.name) }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  >
                    <ServerIcon name={server.name} meta={state.meta[server.name]} bundle={bundlesByName[server.name]} />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-sm font-medium">{server.name}</span>
                      {server.scope && server.scope !== 'user' && server.scope !== 'project' && (
                        <span className="rounded bg-muted px-1 py-px text-xs uppercase text-muted-foreground">{server.scope}</span>
                      )}
                      {isError && (
                        <span
                          className={cn(
                            'shrink-0 rounded px-1 py-px text-xs font-medium uppercase',
                            server.status === 'needs-auth'
                              ? 'bg-warning/15 text-warning'
                              : 'bg-error/15 text-error',
                          )}
                        >
                          {server.status === 'needs-auth' ? t('chat.mcpPopup.authBadge') : t('chat.mcpPopup.errorBadge')}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        probe ? 'ring-1 ring-inset ring-border bg-transparent' : STATUS_DOT[server.status],
                      )}
                    />
                    {!isError && (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">{statusLabel(server, t)}</span>
                    )}
                    {canExpand
                      ? (isExpanded
                        ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />)
                      : <span className="size-3 shrink-0" />}
                  </button>
                  {canAuthenticate && (
                    <IconButton
                      size="xs"
                      className="mr-1 text-warning"
                      aria-label={t('chat.mcpPopup.authenticate', { name: server.name })}
                      tooltip={t('chat.mcpPopup.authenticate', { name: server.name })}
                      disabled={isAuthenticating}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void handleAuthenticate(server.name)}
                    >
                      {isAuthenticating
                        ? <RefreshCw className="animate-spin" />
                        : <LogIn />}
                    </IconButton>
                  )}
                </div>
                {isExpanded && canExpand && (
                  // ml aligns the guide line with the icon center: button px-2 (8px) + size-7 icon half (14px) = 22px
                  <div className="ml-[22px] mb-1 space-y-0.5 border-l border-border pl-2">
                    {hasErrorDetail && (
                      <p className="whitespace-pre-wrap break-words rounded px-2 py-1 font-mono text-xs text-error">
                        {server.error}
                      </p>
                    )}
                    {tools.map((tool) => (
                      <div key={tool.name} className="rounded px-2 py-1 hover:bg-muted/30">
                        <p className="font-mono text-xs text-foreground">{tool.name}</p>
                        {tool.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
