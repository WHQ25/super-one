import { useEffect, useState, type ReactNode } from 'react'
import { Plus, ChevronRight, ArrowLeft, Check, Library, RefreshCw, Trash2, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { Badge } from '@superone/ui/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { McpDetailHeader, McpDetailPage, McpToolsSection } from './McpDetailPage'
import { AddServerPanel } from './AddServerPanel'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl'
import { SettingsEmptyState, SettingsLoadingState } from '@/components/settings/SettingsEmptyState'
import type { McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta } from '@superone/shared/agent-types'
import type { McpbInstalledEntry } from '@superone/shared/mcpb-types'
import { cn } from '@superone/ui/lib/utils'

export function McpIcon({ name, meta, bundle, size = 'sm', className }: { name: string; meta?: McpServerMeta; bundle?: McpbInstalledEntry; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const src = meta?.icons?.[0]?.src ?? bundle?.iconDataUrl
  const boxClass = size === 'md' ? 'size-10' : size === 'xs' ? 'size-7' : 'size-9'
  const textClass = size === 'md' ? 'text-base' : size === 'xs' ? 'text-xs' : 'text-sm'

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover', boxClass, className)}
      />
    )
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground', boxClass, textClass, className)}>
      {name[0]}
    </div>
  )
}

/** One server on the MCP list card: identity + live status, with the enable switch trailing. */
function McpServerRow({
  icon,
  name,
  badge,
  statusDotClass,
  statusText,
  dimmed,
  onSelect,
  extra,
  trailing,
}: {
  icon: ReactNode
  name: string
  badge?: ReactNode
  statusDotClass: string
  statusText: string
  dimmed?: boolean
  onSelect?: () => void
  /** Inline control after the name, e.g. a reconnect button. */
  extra?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        settingsRowClassName,
        'flex items-center gap-3 text-left',
        onSelect && 'cursor-pointer transition-colors hover:bg-muted/60',
      )}
    >
      <div className={cn('flex min-w-0 flex-1 items-center gap-3', dimmed && 'opacity-50')}>
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm">{name}</p>
            {badge}
            {extra}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className={cn('size-1.5 shrink-0 rounded-full', statusDotClass)} />
            <span className="truncate text-xs text-muted-foreground" title={statusText}>{statusText}</span>
          </div>
        </div>
      </div>
      {trailing && (
        <>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {trailing}
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </>
      )}
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
    <McpServerRow
      icon={<McpIcon name={config.name} meta={meta} bundle={bundle} size="xs" className="bg-background" />}
      name={config.name}
      badge={bundle && (
        <Badge variant="outline" className="shrink-0 gap-1 px-1.5 py-0 text-[10px] font-normal">
          <Package className="size-2.5" />
          v{bundle.meta.version}
        </Badge>
      )}
      extra={!isManaged && isFailed && (
        <button
          onClick={handleReconnect}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className={cn('size-3', reconnecting && 'animate-spin')} />
        </button>
      )}
      statusDotClass={dotColor}
      statusText={statusText}
      dimmed={config.disabled}
      onSelect={interactive ? () => selectMcp(config.name) : undefined}
      trailing={interactive && (
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => toggleMcpConfig(config.name, !checked, config.scope)}
        />
      )}
    />
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

  const header = (
    <div className={cn(settingsRowClassName, 'flex items-center gap-2')}>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.back')}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
      </button>
      <h3 className="text-sm font-medium">{t('resources.mcp.libraryView.title')}</h3>
    </div>
  )

  if (mcpLibrary.length === 0) {
    return (
      <div>
        {header}
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t('resources.mcp.libraryView.empty')}
        </p>
      </div>
    )
  }

  return (
    <div>
      {header}

      {/* Grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 p-3">
        {mcpLibrary.map((entry) => {
          const isAdded = existingNames.has(entry.name)
          const isSelected = selected.has(entry.name)
          return (
            <div
              key={entry.name}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => toggle(entry.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggle(entry.name)
                }
              }}
              className={cn(
                'relative flex cursor-pointer flex-col items-center gap-2 rounded-md p-3 text-center transition-colors',
                isSelected
                  ? 'bg-primary/10 ring-1 ring-primary'
                  : 'bg-background/60 hover:bg-background',
              )}
            >
              {isSelected && (
                <div className="absolute top-1.5 left-1.5 flex size-4 items-center justify-center rounded-full bg-primary">
                  <Check className="size-2.5 text-primary-foreground" />
                </div>
              )}
              {isAdded && (
                <span className="absolute top-1.5 right-1.5 text-[10px] text-muted-foreground">{t('resources.mcp.libraryView.added')}</span>
              )}
              <McpIcon name={entry.name} meta={{ name: entry.name, icons: entry.icons }} />
              <span className="w-full truncate text-xs">{entry.name}</span>
            </div>
          )
        })}
      </div>

      {/* Bottom action bar */}
      <div className={cn(settingsRowClassName, 'flex flex-wrap items-center justify-between gap-2')}>
        <SettingsSegmentedControl
          value={scope}
          onChange={setScope}
          label={t('resources.mcp.form.scope')}
          options={[
            { value: 'user', label: 'user' },
            { value: 'project', label: 'project' },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="h-7"
            disabled={selectedEntries.length === 0 || adding || deleting}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="size-3.5" />
            {t('resources.mcp.libraryView.deleteButton')} {selectedEntries.length > 0 ? selectedEntries.length : ''}
          </Button>
          <Button size="sm" className="h-7" disabled={addableEntries.length === 0 || adding || deleting} onClick={handleAdd}>
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
  const isDisabled = server.status === 'disabled'
  const isConnected = server.status === 'connected'
  const tools = server.tools ?? []

  return (
    <div className="space-y-5">
      <McpDetailHeader
        icon={<McpIcon name={server.name} size="md" />}
        name={server.name}
        statusDotClass={isConnected ? 'bg-success' : 'bg-error'}
        subtitle={<span className="text-xs text-muted-foreground">claude.ai</span>}
        trailing={<Switch checked={!isDisabled} onCheckedChange={(checked) => onToggle(server.name, !checked)} />}
      />
      <McpToolsSection
        tools={tools}
        toolCount={server.toolCount}
        emptyText={isConnected ? t('resources.mcp.noToolsConnected') : isDisabled ? t('resources.mcp.noToolsDisabled') : t('resources.mcp.noToolsDisconnected')}
      />
    </div>
  )
}

function ClaudeAiSection({ servers, loading, onToggle }: { servers: McpServerInfo[]; loading?: boolean; onToggle: (name: string, disabled: boolean) => void }) {
  const { t } = useTranslation()
  const { selectMcp } = useSettingsStore()
  return (
    <SettingsSection title={t('resources.mcp.claudeAiTitle')}>
      {loading && servers.length === 0 && (
        <SettingsLoadingState label={t('resources.mcp.claudeAiFetching')} className="py-4" />
      )}
      {!loading && servers.length === 0 && (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('resources.mcp.claudeAiEmpty')}</p>
      )}
      {servers.map((server) => {
        const isDisabled = server.status === 'disabled'
        const isConnected = server.status === 'connected'
        const isPending = server.status === 'pending'
        const dotColor = isConnected ? 'bg-success' : isPending ? 'bg-warning' : 'bg-error'
        const statusText = isDisabled ? t('resources.mcp.statusDisabled') : isPending ? t('resources.mcp.statusConnecting') : isConnected ? t('resources.mcp.toolsCount', { count: server.toolCount ?? 0 }) : server.error ?? t('resources.mcp.statusFailed')
        return (
          <McpServerRow
            key={server.name}
            icon={<McpIcon name={server.name} size="xs" className="bg-background" />}
            name={server.name}
            statusDotClass={dotColor}
            statusText={statusText}
            dimmed={isDisabled}
            onSelect={() => selectMcp(server.name)}
            trailing={<Switch checked={!isDisabled} onCheckedChange={(checked) => onToggle(server.name, !checked)} />}
          />
        )
      })}
    </SettingsSection>
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

  const addPanelOpen = addView === 'form' || addView === 'library'

  return (
    // Container queries let the title-line toolbar drop button labels when the detail column is narrow.
    <div className="@container space-y-5">
      <SettingsSection
        title={t('resources.mcp.title')}
        actions={
          <ResourceScopeToolbar
            className="mb-0"
            scope={scope}
            onScopeChange={setScope}
            availableScopes={isDsh ? ['user'] : undefined}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="size-7 p-0"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label={t('resources.mcp.refresh')}
                  title={t('resources.mcp.refresh')}
                >
                  <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
                </Button>
                {!isDsh && mcpLibrary.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    title={t('resources.mcp.library')}
                    onClick={() => setAddView(addView === 'library' ? 'none' : 'library')}
                  >
                    <Library className="size-3.5" />
                    <span className="@max-xl:sr-only">{t('resources.mcp.library')}</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  title={t('resources.mcp.add')}
                  onClick={() => setAddView(addView === 'form' ? 'none' : 'form')}
                >
                  <Plus className="size-3.5" />
                  <span className="@max-xl:sr-only">{t('resources.mcp.add')}</span>
                </Button>
              </>
            }
          />
        }
      >
        {addView === 'form' && (
          <AddServerPanel
            provider={isDsh ? 'dsh' : isCodex ? 'codex' : 'claude'}
            cwd={currentFolder}
            onClose={() => setAddView('none')}
            onInstalled={(name) => toast.success(t('resources.mcp.bundle.installed', { name }))}
            onError={(message) => toast.error(message)}
          />
        )}

        {addView === 'library' && (
          <LibraryView onClose={() => setAddView('none')} />
        )}

        {scopedConfigs.length > 0 ? (
          scopedConfigs.map((config) => (
            <ServerCard
              key={config.name}
              config={config}
              status={(isManaged ? managedCardStatus : mcpStatus).find((s) => s.name === config.name)}
              meta={isManaged ? undefined : mcpMeta[config.name]}
              bundle={bundlesByName[config.name]}
              statusMode={isManaged ? 'managed' : 'live'}
            />
          ))
        ) : !addPanelOpen ? (
          <SettingsEmptyState
            title={t('resources.mcp.empty')}
            hint={isDsh ? t('resources.mcp.emptyHintDsh') : isCodex ? t('resources.mcp.emptyHintCodex') : t('resources.mcp.emptyHintClaude')}
            action={
              <Button size="sm" className="h-7" onClick={() => setAddView('form')}>
                <Plus className="size-3.5" />
                {t('resources.mcp.add')}
              </Button>
            }
          />
        ) : null}
      </SettingsSection>

      {showClaudeAi && hasScopedContent && (
        <ClaudeAiSection
          servers={claudeaiServers}
          loading={checking}
          onToggle={(name, disabled) => toggleMcpConfig(name, disabled, 'claudeai')}
        />
      )}
    </div>
  )
}
