import { useEffect, useState, useCallback, useMemo } from 'react'
import { Check, Plus, Server } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { Button } from '@/components/ui/button'
import type { ApiProvider, AgentType, CreateProviderRequest, UpdateProviderRequest } from '../../../shared/agent-types'
import { ProviderDialog } from './ProviderDialog'
import { ProviderLabel } from './ProviderLabel'


function ConnectButton({ isActive, onClick, label }: { isActive: boolean; onClick: () => void; label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-7 shrink-0 text-xs ${isActive ? 'border-green-500/40 text-green-600 hover:bg-green-50 hover:text-green-600 dark:text-green-400 dark:hover:bg-green-950' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!isActive) onClick() }}
    >
      {label && <span className="mr-1 text-[10px] text-muted-foreground">{label}</span>}
      {isActive ? 'Connected' : 'Connect'} {isActive && <Check className="size-3.5" />}
    </Button>
  )
}

function ProviderRow({
  provider,
  currentAgent,
  onEdit,
  onActivate,
}: {
  provider: ApiProvider
  currentAgent: AgentType
  onEdit: () => void
  onActivate: () => void
}) {
  const configs = JSON.parse(provider.agent_configs || '{}')
  const url = configs[currentAgent]?.base_url || ''
  const isActive = currentAgent === 'claude' ? provider.is_active_claude === 1 : provider.is_active_codex === 1

  return (
    <div className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50" onClick={onEdit}>
      <div className="flex items-center gap-3 overflow-hidden">
        <ProviderLabel provider={provider} fallback={provider.name} size={28} />
        {url && (
          <span className="truncate text-xs text-muted-foreground">{url}</span>
        )}
      </div>
      <ConnectButton isActive={isActive} onClick={onActivate} />
    </div>
  )
}

export function ProvidersPage() {
  const { providers, fetchProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } = useSettingsStore()
  const settingsProvider = useAppStore((s) => s.settingsProvider) as AgentType

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null)

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
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((provider: ApiProvider) => {
    setEditingProvider(provider)
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

  const defaultLabel = settingsProvider === 'codex' ? 'Codex (Default)' : 'Claude Code (Default)'
  const defaultDesc = settingsProvider === 'codex'
    ? 'Uses Codex session auth (ChatGPT login or API key)'
    : 'Uses system environment / Claude CLI auth'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Providers</h2>
          <p className="text-sm text-muted-foreground">
            {settingsProvider === 'codex'
              ? 'Configure third-party OpenAI-compatible API providers for Codex'
              : 'Configure third-party Anthropic-compatible API providers'}
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="size-4" />
          Add Provider
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <Server className="size-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{defaultLabel}</span>
              <p className="text-xs text-muted-foreground">{defaultDesc}</p>
            </div>
          </div>
          <ConnectButton
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
            onActivate={() => handleActivate(p.id)}
          />
        ))}

        {filteredProviders.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No third-party providers configured</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Add Provider" to connect a third-party API
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
      />
    </div>
  )
}
