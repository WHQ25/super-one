import { useEffect, useState, useCallback, useMemo } from 'react'
import { Check, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { resolvePresetKey, getPresetByKey } from '@/lib/preset-match'
import { diffProviderAgainstPreset } from '@/lib/preset-merge'
import type { ApiProvider, AgentType, CreateProviderRequest, UpdateProviderRequest } from '@superone/shared/agent-types'
import { ProviderDialog } from './ProviderDialog'
import { ProviderLabel } from './ProviderLabel'


function DefaultButton({ isActive, onClick, label }: { isActive: boolean; onClick: () => void; label?: string }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-7 shrink-0 text-xs ${isActive ? 'border-primary/40 text-primary hover:bg-primary/10' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!isActive) onClick() }}
    >
      {label && <span className="mr-1 text-[10px] text-muted-foreground">{label}</span>}
      {isActive ? t('resources.providers.default') : t('resources.providers.setDefault')} {isActive && <Check className="size-3.5" />}
    </Button>
  )
}

function ProviderRow({
  provider,
  currentAgent,
  onEdit,
  onSync,
  onActivate,
}: {
  provider: ApiProvider
  currentAgent: AgentType
  onEdit: () => void
  onSync: () => void
  onActivate: () => void
}) {
  const { t } = useTranslation()
  const configs = JSON.parse(provider.agent_configs || '{}')
  const url = configs[currentAgent]?.base_url || ''
  const isActive = currentAgent === 'claude' ? provider.is_active_claude === 1 : provider.is_active_codex === 1

  const hasUpdate = useMemo(() => {
    const key = resolvePresetKey(provider)
    if (!key) return false
    const preset = getPresetByKey(key)
    if (!preset) return false
    return diffProviderAgainstPreset(provider, preset).hasChanges
  }, [provider])

  return (
    <div className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50" onClick={onEdit}>
      <div className="flex items-center gap-3 overflow-hidden">
        <ProviderLabel provider={provider} fallback={provider.name} size={28} />
        {url && (
          <span className="truncate text-xs text-muted-foreground">{url}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {hasUpdate && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSync() }}
                  className="flex size-6 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                  aria-label={t('resources.providers.updateAvailable')}
                >
                  <RefreshCw className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('resources.providers.updateAvailable')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <DefaultButton isActive={isActive} onClick={onActivate} />
      </div>
    </div>
  )
}

export function ProvidersPage() {
  const { t } = useTranslation()
  const { providers, fetchProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } = useSettingsStore()
  const settingsProvider = useAppStore((s) => s.settingsProvider) as AgentType

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null)
  const [autoSync, setAutoSync] = useState(false)

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const filteredProviders = useMemo(() =>
    providers.filter((p) => {
      const agents: string[] = JSON.parse(p.supported_agents || '["claude"]')
      return agents.includes(settingsProvider)
    }),
  [providers, settingsProvider])

  const handleAdd = useCallback(() => {
    setEditingProvider(null)
    setAutoSync(false)
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((provider: ApiProvider) => {
    setEditingProvider(provider)
    setAutoSync(false)
    setDialogOpen(true)
  }, [])

  const handleSync = useCallback((provider: ApiProvider) => {
    setEditingProvider(provider)
    setAutoSync(true)
    setDialogOpen(true)
  }, [])

  const handleSave = useCallback(async (data: CreateProviderRequest | (UpdateProviderRequest & { id: string })) => {
    if ('id' in data) {
      const { id, ...rest } = data
      await updateProvider(id, rest)
    } else {
      await createProvider(data)
    }
  }, [createProvider, updateProvider])

  const handleDelete = useCallback(async (id: string) => {
    await deleteProvider(id)
  }, [deleteProvider])

  const handleActivate = useCallback(async (id: string) => {
    await activateProvider(id, settingsProvider)
  }, [activateProvider, settingsProvider])

  const activeProvider = filteredProviders.find((p) =>
    settingsProvider === 'claude' ? p.is_active_claude === 1 : p.is_active_codex === 1
  )

  const defaultLabel = settingsProvider === 'codex'
    ? t('resources.providers.defaultLabelCodex')
    : t('resources.providers.defaultLabelClaude')
  const defaultDesc = settingsProvider === 'codex'
    ? t('resources.providers.defaultDescCodex')
    : t('resources.providers.defaultDescClaude')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('resources.providers.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {settingsProvider === 'codex'
              ? t('resources.providers.subtitleCodex')
              : t('resources.providers.subtitleClaude')}
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="size-4" />
          {t('resources.providers.add')}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3 overflow-hidden">
            <ProviderLabel
              presetKey={settingsProvider === 'codex' ? 'default-codex' : 'default-claude'}
              fallback={defaultLabel}
              size={28}
            />
            <span className="truncate text-xs text-muted-foreground">{defaultDesc}</span>
          </div>
          <DefaultButton
            isActive={!activeProvider}
            onClick={() => deactivateAllProviders(settingsProvider)}
          />
        </div>

        {filteredProviders.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            currentAgent={settingsProvider}
            onEdit={() => handleEdit(p)}
            onSync={() => handleSync(p)}
            onActivate={() => handleActivate(p.id)}
          />
        ))}

        {filteredProviders.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">{t('resources.providers.empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('resources.providers.emptyHint')}
            </p>
          </div>
        )}
      </div>

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editProvider={editingProvider}
        onSave={handleSave}
        onDelete={handleDelete}
        agentFilter={settingsProvider}
        autoSync={autoSync}
      />
    </div>
  )
}
