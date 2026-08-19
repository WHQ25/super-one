import { useEffect, useState } from 'react'
import { Plus, ChevronRight, ArrowLeft, Check, Library, RefreshCw, Trash2, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { Badge } from '@superone/ui/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { McpDetailPage } from './McpDetailPage'
import { AddServerPanel } from './AddServerPanel'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import type { McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta } from '@superone/shared/agent-types'
import type { McpbInstalledEntry } from '@superone/shared/mcpb-types'
import { cn } from '@superone/ui/lib/utils'

export function McpIcon({ name, meta, bundle, size = 'sm' }: { name: string; meta?: McpServerMeta; bundle?: McpbInstalledEntry; size?: 'sm' | 'md' }) {
  const src = meta?.icons?.[0]?.src ?? bundle?.iconDataUrl
  const sizeClass = size === 'md' ? 'size-10 text-base' : 'size-9 text-sm'

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover', size === 'md' ? 'size-10' : 'size-9')}
      />
    )
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground', sizeClass)}>
      {name[0]}
    </div>
  )
}

function ServerCard({
  config,
  status,
  meta,
  bundle,
  interactive = true,
  statusMode = 'live',
}: {
  config: McpServerConfig
  status?: McpServerInfo
  meta?: McpServerMeta
  bundle?: McpbInstalledEntry
  interactive?: boolean
  statusMode?: 'live' | 'managed'
}) {
  const { t } = useTranslation()
  const { selectMcp, toggleMcpConfig, checkMcpServers } = useSettingsStore()
  const [reconnecting, setReconnecting] = useState(false)
  const isManaged = statusMode === 'managed'
  const serverStatus = status?.status ?? (config.disabled ? 'disabled' : isManaged ? 'connected' : 'pending')
  const isEnabled = !config.disabled
  const isConnected = serverStatus === 'connected'
  const isPending = serverStatus === 'pending' || reconnecting
  const isFailed = isEnabled && !isConnected && !isPending
  const toolCount = status?.toolCount ?? 0

  const dotColor = isManaged
    ? (config.disabled ? 'bg-error' : 'bg-success')
    : (isConnected ? 'bg-success' : isPending ? 'bg-warning' : 'bg-error')
  const statusText = config.disabled
    ? t('resources.mcp.statusDisabled')
    : isManaged
      ? config.type
      : isPending
        ? t('resources.mcp.statusConnecting')
        : isFailed && status?.error
          ? status.error
          : t('resources.mcp.toolsCount', { count: toolCount })

  const handleReconnect = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setReconnecting(true)
    try {
      await checkMcpServers()
      setReconnecting(false)
    } catch (e) {
      setReconnecting(false)
      throw e
    }
  }

  return (
    <div
      onClick={() => interactive && selectMcp(config.name)}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors',
        interactive && 'cursor-pointer hover:bg-accent/50',
        config.disabled && 'opacity-50'
      )}
    >
      <McpIcon name={config.name} meta={meta} bundle={bundle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{config.name}</p>
          {bundle && (
            <Badge variant="outline" className="shrink-0 gap-1 px-1.5 py-0 text-[10px] font-normal">
              <Package className="size-2.5" />
              v{bundle.meta.version}
            </Badge>
          )}
          {!isManaged && isFailed && (
            <button
              onClick={handleReconnect}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('size-3', reconnecting && 'animate-spin')} />
            </button>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn('size-2 shrink-0 rounded-full', dotColor)} />
          <span className="text-xs text-muted-foreground">{statusText}</span>
        </div>
      </div>
      {interactive && (
        <>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => toggleMcpConfig(config.name, !checked, config.scope)}
            />
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </>
      )}
    </div>
  )
}

function LibraryView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const { mcpLibrary, mcpConfigs, codexMcpConfigs, saveMcpConfig, fetchMcpLibrary, deleteMcpLibraryEntry } = useSettingsStore()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => { fetchMcpLibrary() }, [fetchMcpLibrary])

  const activeConfigs = settingsProvider === 'codex' ? codexMcpConfigs : mcpConfigs
  const existingNames = new Set(activeConfigs.map((c) => c.name))
  const selectedEntries = mcpLibrary.filter((entry) => selected.has(entry.name))
  const addableEntries = selectedEntries.filter((entry) => !existingNames.has(entry.name))

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAdd = async () => {
    if (addableEntries.length === 0) return
    setAdding(true)
    for (const entry of addableEntries) {
      const config: Partial<Pick<McpLibraryEntry, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>> = { type: entry.type }
      if (entry.type === 'stdio') {
        config.command = entry.command
        config.args = entry.args
        config.env = entry.env
      } else {
        config.url = entry.url
        config.headers = entry.headers
      }
      await saveMcpConfig(entry.name, config, scope)
    }
    setAdding(false)
    onClose()
  }

  const handleDeleteConfirm = async () => {
    if (selectedEntries.length === 0) return
    setDeleting(true)
    try {
      for (const entry of selectedEntries) {
        await deleteMcpLibraryEntry(entry.name)
      }
      setSelected(new Set())
      setDeleteConfirmOpen(false)
      setDeleting(false)
    } catch (e) {
      setDeleting(false)
      throw e
    }
  }

  if (mcpLibrary.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </button>
          <h3 className="text-sm font-medium">{t('resources.mcp.libraryView.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground text-center py-6">
          {t('resources.mcp.libraryView.empty')}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
        <h3 className="text-sm font-medium">{t('resources.mcp.libraryView.title')}</h3>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 gap-2">
        {mcpLibrary.map((entry) => {
          const isAdded = existingNames.has(entry.name)
          const isSelected = selected.has(entry.name)
          return (
            <div
              key={entry.name}
              role="button"
              tabIndex={0}
              onClick={() => toggle(entry.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle(entry.name)
                }
              }}
              className={cn(
                'relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-colors text-center',
                'cursor-pointer',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : isAdded
                    ? 'border-border bg-muted/40 hover:border-muted-foreground/30'
                    : 'border-border hover:border-muted-foreground/30',
              )}
            >
              {isSelected && (
                <div className="absolute left-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary">
                  <Check className="size-2.5 text-primary-foreground" />
                </div>
              )}
              {isAdded && (
                <span className="absolute right-1.5 top-1.5 text-[10px] text-muted-foreground">{t('resources.mcp.libraryView.added')}</span>
              )}
              <McpIcon name={entry.name} meta={{ name: entry.name, icons: entry.icons }} />
              <span className="text-xs font-medium truncate w-full">{entry.name}</span>
            </div>
          )
        })}
      </div>

      {/* Bottom action bar */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="flex gap-2">
          {(['user', 'project'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={selectedEntries.length === 0 || adding || deleting}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="size-4" />
            {t('resources.mcp.libraryView.deleteButton')} {selectedEntries.length > 0 ? selectedEntries.length : ''}
          </Button>
          <Button size="sm" disabled={addableEntries.length === 0 || adding || deleting} onClick={handleAdd}>
            {adding ? t('resources.mcp.libraryView.adding') : t('resources.mcp.libraryView.addCount', { count: addableEntries.length })}
          </Button>
        </div>
      </div>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('resources.mcp.libraryView.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('resources.mcp.libraryView.deleteDescription', { count: selectedEntries.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting || selectedEntries.length === 0}>
              {deleting ? t('resources.mcp.libraryView.deleting') : t('resources.mcp.libraryView.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ClaudeAiDetailPage({ server, onToggle }: { server: McpServerInfo; onToggle: (name: string, disabled: boolean) => void }) {
  const { t } = useTranslation()
  const { selectMcp } = useSettingsStore()
  const isDisabled = server.status === 'disabled'
  const isConnected = server.status === 'connected'
  const tools = server.tools ?? []

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <button
          onClick={() => selectMcp(null)}
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" />
          {t('common.back')}
        </button>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-base font-medium uppercase text-muted-foreground">
            {server.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{server.name}</h2>
              <span className={cn('size-2 rounded-full', isConnected ? 'bg-success' : 'bg-error')} />
            </div>
            <span className="text-xs text-muted-foreground">claude.ai</span>
          </div>
          <Switch checked={!isDisabled} onCheckedChange={(checked) => onToggle(server.name, !checked)} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">
          {t('resources.mcp.tools')}
          {server.toolCount != null && (
            <span className="ml-2 text-xs text-muted-foreground">({server.toolCount})</span>
          )}
        </h3>
        {tools.length > 0 ? (
          <div className="space-y-2">
            {tools.map((tool) => (
              <div key={tool.name} className="rounded-md border border-border px-3 py-2">
                <p className="text-sm font-medium font-mono">{tool.name}</p>
                {tool.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isConnected ? t('resources.mcp.noToolsConnected') : isDisabled ? t('resources.mcp.noToolsDisabled') : t('resources.mcp.noToolsDisconnected')}
          </p>
        )}
      </div>
    </div>
  )
}

function ClaudeAiSection({ servers, loading, onToggle }: { servers: McpServerInfo[]; loading?: boolean; onToggle: (name: string, disabled: boolean) => void }) {
  const { t } = useTranslation()
  const { selectMcp } = useSettingsStore()
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('resources.mcp.claudeAiTitle')}</h3>
      {loading && servers.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4">
          <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t('resources.mcp.claudeAiFetching')}</span>
        </div>
      )}
      {!loading && servers.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">{t('resources.mcp.claudeAiEmpty')}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {servers.map((server) => {
          const isDisabled = server.status === 'disabled'
          const isConnected = server.status === 'connected'
          const isPending = server.status === 'pending'
          const dotColor = isConnected ? 'bg-success' : isPending ? 'bg-warning' : isDisabled ? 'bg-error' : 'bg-error'
          const statusText = isDisabled ? t('resources.mcp.statusDisabled') : isPending ? t('resources.mcp.statusConnecting') : isConnected ? t('resources.mcp.toolsCount', { count: server.toolCount ?? 0 }) : server.error ?? t('resources.mcp.statusFailed')
          return (
            <div
              key={server.name}
              onClick={() => selectMcp(server.name)}
              className={cn('flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer transition-colors hover:bg-accent/50', isDisabled && 'opacity-50')}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase text-muted-foreground">
                {server.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{server.name}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn('size-2 shrink-0 rounded-full', dotColor)} />
                  <span className="text-xs text-muted-foreground">{statusText}</span>
                </div>
              </div>
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <Switch checked={!isDisabled} onCheckedChange={(checked) => onToggle(server.name, !checked)} />
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ServerSection({
  title,
  configs,
  mcpStatus,
  mcpMeta,
  bundlesByName,
  interactive = true,
  statusMode = 'live',
}: {
  title?: string
  configs: McpServerConfig[]
  mcpStatus: McpServerInfo[]
  mcpMeta: Record<string, McpServerMeta>
  bundlesByName?: Record<string, McpbInstalledEntry>
  interactive?: boolean
  statusMode?: 'live' | 'managed'
}) {
  if (configs.length === 0) return null
  return (
    <div>
      {title ? (
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {configs.map((config) => (
          <ServerCard
            key={config.name}
            config={config}
            status={mcpStatus.find((s) => s.name === config.name)}
            meta={mcpMeta[config.name]}
            bundle={bundlesByName?.[config.name]}
            interactive={interactive}
            statusMode={statusMode}
          />
        ))}
      </div>
    </div>
  )
}

export function McpPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const { mcpConfigs, mcpStatus, mcpMeta, mcpLibrary, mcpbInstalled, codexMcpConfigs, codexMcpStatus, dshMcpConfigs, selectedMcpName, fetchMcpConfigs, checkMcpServers, fetchMcpLibrary, fetchMcpbInstalled, fetchCodexMcpConfigs, fetchCodexMcpStatus, fetchDshMcpConfigs, selectMcp, toggleMcpConfig } = useSettingsStore()
  const [addView, setAddView] = useState<'none' | 'form' | 'library'>('none')
  const [refreshing, setRefreshing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [scope, setScope] = useState<ResourceScopeView>('user')
  const isCodex = settingsProvider === 'codex'
  const isDsh = settingsProvider === 'dsh'
  const isManaged = isCodex || isDsh

  useEffect(() => {
    selectMcp(null)
    setAddView('none')
    fetchMcpbInstalled()
    fetchMcpLibrary()
    if (isDsh) {
      setScope('user')
      fetchDshMcpConfigs()
    } else if (isCodex) {
      fetchCodexMcpConfigs()
      fetchCodexMcpStatus()
    } else {
      fetchMcpConfigs()
      setChecking(true)
      checkMcpServers().finally(() => setChecking(false))
    }
  }, [currentFolder, isCodex, isDsh, fetchMcpConfigs, checkMcpServers, fetchMcpLibrary, fetchMcpbInstalled, fetchCodexMcpConfigs, fetchCodexMcpStatus, fetchDshMcpConfigs, selectMcp])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      if (isDsh) {
        await fetchDshMcpConfigs()
      } else if (isCodex) {
        await fetchCodexMcpConfigs()
        await fetchCodexMcpStatus()
      } else {
        await checkMcpServers()
      }
      await fetchMcpbInstalled()
      setRefreshing(false)
    } catch (e) {
      setRefreshing(false)
      throw e
    }
  }

  const claudeaiServers = isManaged ? [] : mcpStatus.filter((s) => s.scope === 'claudeai')

  const currentConfigs = isDsh ? dshMcpConfigs : isCodex ? codexMcpConfigs : mcpConfigs
  const userConfigs = currentConfigs.filter((c) => c.scope === 'user')
  const projectConfigs = currentConfigs.filter((c) => c.scope === 'project')
  const scopedConfigs = scope === 'user' ? userConfigs : projectConfigs
  const managedCardStatus = currentConfigs.map((config) =>
    (isCodex ? codexMcpStatus.find((status) => status.name === config.name) : undefined) ?? {
      name: config.name,
      scope: config.scope,
      status: config.disabled ? 'disabled' : 'pending',
      toolCount: 0,
      tools: [],
      stale: true,
    },
  ) as McpServerInfo[]

  if (selectedMcpName) {
    if (!isManaged) {
      const claudeaiServer = claudeaiServers.find((s) => s.name === selectedMcpName)
      if (claudeaiServer) return <ClaudeAiDetailPage server={claudeaiServer} onToggle={(name, disabled) => toggleMcpConfig(name, disabled, 'claudeai')} />
    }
    const config = currentConfigs.find((c) => c.name === selectedMcpName)
    const status = (isManaged ? managedCardStatus : mcpStatus).find((s) => s.name === selectedMcpName)
    if (config) return <McpDetailPage config={config} status={status} meta={isManaged ? undefined : mcpMeta[config.name]} />
  }

  const showClaudeAi = scope === 'user' && !isManaged
  const hasScopedContent =
    scopedConfigs.length > 0 || (showClaudeAi && (claudeaiServers.length > 0 || checking))

  const bundleProvider = isDsh ? null : isCodex ? 'codex' : 'claude'
  const bundlesByName: Record<string, McpbInstalledEntry> = {}
  for (const entry of mcpbInstalled) {
    if (bundleProvider && entry.meta.provider === bundleProvider) bundlesByName[entry.meta.name] = entry
  }

  return (
    <div className="w-full">
      <ResourceScopeToolbar
        scope={scope}
        onScopeChange={setScope}
        availableScopes={isDsh ? ['user'] : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
              {t('resources.mcp.refresh')}
            </Button>
            {!isDsh && mcpLibrary.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddView(addView === 'library' ? 'none' : 'library')}
              >
                <Library className="size-4" />
                {t('resources.mcp.library')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddView(addView === 'form' ? 'none' : 'form')}
            >
              <Plus className="size-4" />
              {t('resources.mcp.add')}
            </Button>
          </>
        }
      />

      {addView === 'form' && (
        <div className="mb-4">
          <AddServerPanel
            provider={isDsh ? 'dsh' : isCodex ? 'codex' : 'claude'}
            cwd={currentFolder}
            onClose={() => setAddView('none')}
            onInstalled={(name) => toast.success(t('resources.mcp.bundle.installed', { name }))}
            onError={(message) => toast.error(message)}
          />
        </div>
      )}

      {addView === 'library' && (
        <div className="mb-4">
          <LibraryView onClose={() => setAddView('none')} />
        </div>
      )}

      {!hasScopedContent ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('resources.mcp.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isDsh ? t('resources.mcp.emptyHintDsh') : isCodex ? t('resources.mcp.emptyHintCodex') : t('resources.mcp.emptyHintClaude')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {showClaudeAi && (
            <ClaudeAiSection
              servers={claudeaiServers}
              loading={checking}
              onToggle={(name, disabled) => toggleMcpConfig(name, disabled, 'claudeai')}
            />
          )}
          {scopedConfigs.length > 0 && (
            <ServerSection
              configs={scopedConfigs}
              mcpStatus={isManaged ? managedCardStatus : mcpStatus}
              mcpMeta={isManaged ? {} : mcpMeta}
              bundlesByName={bundlesByName}
              statusMode={isManaged ? 'managed' : 'live'}
            />
          )}
        </div>
      )}
    </div>
  )
}
