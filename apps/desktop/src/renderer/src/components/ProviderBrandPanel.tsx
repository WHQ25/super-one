import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@superone/ui/components/ui/select'
import type { ApiProvider, AgentType, CreateProviderRequest } from '@superone/shared/agent-types'
import { PRESET_PROVIDER_KEY } from '@superone/shared/provider-utils'
import { draftProviderFromPreset, draftFromProvider, uniqueKeyName, type ProviderBrand } from '@/lib/provider-brands'
import { ProviderDetailPanel } from './ProviderDetailPanel'
import { ProviderLabel } from './ProviderLabel'

type SaveData = { name: string; key_name: string; api_key: string; supported_agents: string; agent_configs: string; capabilities: string }

const ADD_KEY_VALUE = '__add_key__'

export function ProviderBrandPanel({
  brand,
  forceCreate,
  onCreate,
  onSave,
  onDelete,
  onActivate,
  onDeactivate,
}: {
  brand: ProviderBrand
  forceCreate: boolean
  onCreate: (data: CreateProviderRequest) => Promise<ApiProvider>
  onSave: (id: string, data: SaveData) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onActivate: (id: string, harness: AgentType) => Promise<void>
  onDeactivate: (harness: AgentType) => Promise<void>
}) {
  const { t } = useTranslation()
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(
    forceCreate || brand.providers.length === 0 ? null : brand.providers[0].id,
  )
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => {
    if (selectedKeyId && !brand.providers.some((p) => p.id === selectedKeyId)) {
      setSelectedKeyId(brand.providers[0]?.id ?? null)
    }
  }, [brand.providers, selectedKeyId])

  const creating = selectedKeyId === null
  const selectedProvider = creating ? null : brand.providers.find((p) => p.id === selectedKeyId) ?? null
  const preset = brand.presets[0]

  const draft = useMemo(() => {
    const last = brand.providers[brand.providers.length - 1]
    let d = last ? draftFromProvider(last) : preset ? draftProviderFromPreset(preset) : null
    if (!d) return null
    if (!brand.editableName) d = { ...d, name: brand.name }
    else if (!last) d = { ...d, name: '' }
    return { ...d, key_name: uniqueKeyName('default', brand.providers.map((p) => p.key_name)) }
  }, [preset, brand.editableName, brand.name, brand.providers])

  const existingKeyNames = useMemo(
    () => brand.providers.filter((p) => p.id !== selectedKeyId).map((p) => p.key_name),
    [brand.providers, selectedKeyId],
  )

  const handleCreate = useCallback(
    async (data: CreateProviderRequest) => {
      const created = await onCreate(data)
      setSelectedKeyId(created.id)
    },
    [onCreate],
  )

  const provider = creating ? draft : selectedProvider
  const brandKey = (brand.presetKey && PRESET_PROVIDER_KEY[brand.presetKey]) || null
  if (!provider) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderLabel presetKey={brand.presetKey} combine fallback={brand.name} size={40} />
          {brand.regionLabel && <span className="text-xs text-muted-foreground">({brand.regionLabel})</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Select
            value={creating ? '' : selectedKeyId ?? ''}
            onValueChange={(v) => setSelectedKeyId(v === ADD_KEY_VALUE ? null : v)}
          >
            <SelectTrigger size="sm" className="min-w-28">
              <SelectValue placeholder={t('resources.providers.newKey')} />
            </SelectTrigger>
            <SelectContent>
              {brand.providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.key_name || 'default'}</SelectItem>
              ))}
              {brand.providers.length > 0 && <SelectSeparator />}
              <SelectItem value={ADD_KEY_VALUE}>
                <Plus className="size-3.5" /> {t('resources.providers.addKey')}
              </SelectItem>
            </SelectContent>
          </Select>
          {selectedProvider && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteOpen(true)}>
              <Trash2 className="size-3.5" /> {t('resources.providerDialog.delete')}
            </Button>
          )}
        </div>
      </div>

      {selectedProvider && (
        <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('resources.providers.deleteKeyTitle')}</DialogTitle>
              <DialogDescription>
                {t('resources.providers.deleteKeyDescription', { name: selectedProvider.key_name || 'default' })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDeleteOpen(false)}>{t('common.cancel')}</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await onDelete(selectedProvider.id)
                  setConfirmDeleteOpen(false)
                }}
              >
                {t('resources.providerDialog.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ProviderDetailPanel
        key={creating ? `draft:${preset?.key ?? ''}` : selectedKeyId!}
        provider={provider}
        apiKeyUrl={creating ? preset?.apiKeyUrl : brand.apiKeyUrl}
        nameEditable={brand.editableName}
        existingKeyNames={existingKeyNames}
        brandKey={brandKey}
        onCreate={handleCreate}
        onSave={onSave}
        onActivate={onActivate}
        onDeactivate={onDeactivate}
      />
    </div>
  )
}
