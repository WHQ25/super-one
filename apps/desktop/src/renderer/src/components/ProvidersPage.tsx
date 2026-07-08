import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { AgentType, CreateProviderRequest } from '@superone/shared/agent-types'
import { buildProviderBrands, draftCustomBrand, providerBrandId, DRAFT_CUSTOM_BRAND_ID, type ProviderBrand } from '@/lib/provider-brands'
import { ProviderBrandPanel } from './ProviderBrandPanel'
import { OfficialProviderPanel } from './OfficialProviderPanel'
import { ProviderLabel } from './ProviderLabel'

const OFFICIAL_PROVIDERS = [
  { id: 'official-claude', harness: 'claude', presetKey: 'default-claude' },
  { id: 'official-codex', harness: 'codex', presetKey: 'default-codex' },
] as const

function OfficialRow({ presetKey, plan, selected, onClick }: { presetKey: string; plan?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
        selected ? 'bg-primary/10' : 'hover:bg-muted/50'
      }`}
    >
      <ProviderLabel presetKey={presetKey} combine size={26} />
      {plan && <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{plan}</span>}
    </button>
  )
}

function BrandRow({ brand, selected, onClick }: { brand: ProviderBrand; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  const count = brand.providers.length
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
        selected ? 'bg-primary/10' : 'hover:bg-muted/50'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ProviderLabel presetKey={brand.presetKey} combine fallback={brand.name} size={26} />
        {brand.regionLabel && <span className="shrink-0 text-[11px] text-muted-foreground">({brand.regionLabel})</span>}
      </span>
      {count > 0 && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{t('resources.providers.keyCount', { count })}</span>
      )}
    </button>
  )
}

type OfficialEntry = (typeof OFFICIAL_PROVIDERS)[number]

function Group({ title, officials, brands, plans, selectedId, onSelect }: { title: string; officials: OfficialEntry[]; brands: ProviderBrand[]; plans?: Partial<Record<AgentType, string>>; selectedId: string | null; onSelect: (id: string) => void }) {
  if (officials.length === 0 && brands.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      {officials.map((o) => (
        <OfficialRow key={o.id} presetKey={o.presetKey} plan={plans?.[o.harness]} selected={selectedId === o.id} onClick={() => onSelect(o.id)} />
      ))}
      {brands.map((brand) => (
        <BrandRow key={brand.brandId} brand={brand} selected={selectedId === brand.brandId} onClick={() => onSelect(brand.brandId)} />
      ))}
    </div>
  )
}

export function ProvidersPage() {
  const { t } = useTranslation()
  const { providers, fetchProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } = useSettingsStore()
  const activeProject = useChatStore((s) => s.activeProject)
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [draft, setDraft] = useState(false)
  const [createSeq, setCreateSeq] = useState(0)
  const [signedIn, setSignedIn] = useState<{ claude: boolean; codex: boolean }>({ claude: false, codex: false })
  const [plan, setPlan] = useState<{ claude?: string; codex?: string }>({})
  const claudeAccount = useChatStore((s) => s.harnessResources.claude?.account)

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  useEffect(() => {
    window.app.claudeGetRateLimits().then((r) => {
      setSignedIn((s) => ({ ...s, claude: !!r && (r.windows.length > 0 || !!r.planType) }))
      setPlan((p) => ({ ...p, claude: r?.planType || undefined }))
    }).catch(() => {})
    if (activeProject) {
      window.app.codexGetAuthStatus(activeProject)
        .then((a) => setSignedIn((s) => ({ ...s, codex: a.resolvedMode === 'chatgpt' || a.hasEnvApiKey || a.hasSessionApiKey })))
        .catch(() => {})
      window.app.codexGetRateLimits(activeProject, null)
        .then((r) => setPlan((p) => ({ ...p, codex: r?.planType || undefined })))
        .catch(() => {})
    }
  }, [activeProject])

  const officialPlans = useMemo<Partial<Record<AgentType, string>>>(
    () => ({ claude: claudeAccount?.subscriptionType || plan.claude, codex: plan.codex }),
    [claudeAccount?.subscriptionType, plan.claude, plan.codex],
  )

  const brands = useMemo(() => buildProviderBrands(providers), [providers])
  const { enabled, others } = useMemo(() => {
    const enabled: ProviderBrand[] = []
    const others: ProviderBrand[] = []
    for (const b of brands) (b.providers.length > 0 ? enabled : others).push(b)
    return { enabled, others }
  }, [brands])

  const { officialEnabled, officialOthers } = useMemo(() => {
    const officialEnabled: OfficialEntry[] = []
    const officialOthers: OfficialEntry[] = []
    for (const o of OFFICIAL_PROVIDERS) (signedIn[o.harness] ? officialEnabled : officialOthers).push(o)
    return { officialEnabled, officialOthers }
  }, [signedIn])

  const official = OFFICIAL_PROVIDERS.find((o) => o.id === selectedBrandId) ?? null
  const selectedBrand = draft ? draftCustomBrand() : brands.find((b) => b.brandId === selectedBrandId) ?? null

  const selectBrand = useCallback((id: string) => {
    setDraft(false)
    setSelectedBrandId(id)
  }, [])

  const addCustom = useCallback(() => {
    setDraft(true)
    setSelectedBrandId(DRAFT_CUSTOM_BRAND_ID)
    setCreateSeq((s) => s + 1)
  }, [])

  const handleSave = useCallback(async (id: string, data: { name: string; key_name: string; api_key: string; supported_agents: string; agent_configs: string; capabilities: string }) => {
    await updateProvider(id, data)
  }, [updateProvider])

  const handleCreate = useCallback(async (data: CreateProviderRequest) => {
    const created = await createProvider(data)
    if (draft) {
      setDraft(false)
      setSelectedBrandId(providerBrandId(created))
    }
    return created
  }, [createProvider, draft])

  const handleDelete = useCallback(async (id: string) => {
    await deleteProvider(id)
  }, [deleteProvider])

  const handleActivate = useCallback(async (id: string, harness: AgentType) => {
    await activateProvider(id, harness)
  }, [activateProvider])

  const handleDeactivate = useCallback(async (harness: AgentType) => {
    await deactivateAllProviders(harness)
  }, [deactivateAllProviders])

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('resources.providers.title')}</h2>
          <IconButton size="md" tooltip={t('resources.providers.addCustom')} onClick={addCustom}>
            <Plus className="size-4" />
          </IconButton>
        </div>

        <Group title={t('resources.providers.enabled')} officials={officialEnabled} brands={enabled} plans={officialPlans} selectedId={selectedBrandId} onSelect={selectBrand} />
        <Group title={t('resources.providers.others')} officials={officialOthers} brands={others} selectedId={selectedBrandId} onSelect={selectBrand} />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto px-1 py-1">
        {official ? (
          <OfficialProviderPanel harness={official.harness} />
        ) : selectedBrand ? (
          <ProviderBrandPanel
            key={`${selectedBrand.brandId}-${createSeq}`}
            brand={selectedBrand}
            forceCreate={draft}
            onCreate={handleCreate}
            onSave={handleSave}
            onDelete={handleDelete}
            onActivate={handleActivate}
            onDeactivate={handleDeactivate}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('resources.providers.selectHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
