import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Badge } from '@superone/ui/components/ui/badge'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  applyCapabilitiesToPlan,
  defaultOverridesForPlan,
  isCustomPlatform,
  planCapabilities,
  type Credential,
  type EndpointOverride,
  type Plan,
  type Platform,
} from '@superone/shared/platform-registry'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useIsDark } from '@/hooks/use-is-dark'
import { siteRootOf } from './providers/site-url'
import { platformsByBrand } from '@/lib/provider-resolve'
import { OfficialProviderPanel } from './OfficialProviderPanel'
import { ProviderLabel } from './ProviderLabel'
import { EndpointConfigSection } from './providers/EndpointConfigSection'
import { CredentialConfig, OverridesEditor } from './providers/CredentialConfig'
import { CredentialTabs } from './providers/CredentialTabs'
import { CustomPlatformForm } from './providers/CustomPlatformForm'
import { PlatformModelsPanel } from './providers/PlatformModelsPanel'
import { plansByKeyCount } from './providers/plan-order'

const BRAND_POPULARITY = [
  'anthropic',
  'openai',
  'gemini',
  'deepseek',
  'zhipu',
  'zai',
  'kimi',
  'moonshot',
  'openrouter',
  'bedrock',
  'vertexai',
  'minimax',
  'bailian',
  'volcengine',
  'siliconcloud',
  'modelscope',
  'xiaomimimo',
  'nvidia',
  'kwaikat',
  'longcat'
]

function brandRank(brand: string): number {
  const i = BRAND_POPULARITY.indexOf(brand)
  return i === -1 ? BRAND_POPULARITY.length : i
}

function platformVariantLabel(platform: Platform, all: Platform[]): string | null {
  if (isCustomPlatform(platform)) return null
  return all.filter((p) => p.brand === platform.brand).length > 1 ? platform.name : null
}

function isOfficial(platform: Platform): boolean {
  return platform.plans.some((p) => p.auth === 'oauth')
}

function officialHarness(platform: Platform): 'claude' | 'codex' {
  return platform.brand === 'openai' ? 'codex' : 'claude'
}

// --- plan section (keys + advanced, shared draft state) ----------------------

function PlanSection({
  platform,
  plan,
  selectedKeyId,
  onSelectKey,
  extraDirty,
  onSaveExtras,
}: {
  platform: Platform
  plan: Plan
  selectedKeyId: string
  onSelectKey: (id: string) => void
  extraDirty?: boolean
  onSaveExtras?: () => Promise<void>
}) {
  const credentials = useSettingsStore((s) => s.credentials)
  const planCreds = useMemo(
    () => credentials.filter((c) => c.platformId === platform.id && c.planId === plan.id),
    [credentials, platform.id, plan.id],
  )
  const takenNames = useMemo(
    () => credentials.filter((c) => c.platformId === platform.id).map((c) => c.name),
    [credentials, platform.id],
  )
  const planDefaults = useMemo(() => defaultOverridesForPlan(plan), [plan])
  const [adding, setAdding] = useState(planCreds.length === 0)
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, EndpointOverride>>(planDefaults)
  const activeKeyId = planCreds.some((c) => c.id === selectedKeyId) ? selectedKeyId : (planCreds[0]?.id ?? '')

  const closeAdd = useCallback(() => {
    setAdding(false)
    setPendingOverrides(planDefaults)
  }, [planDefaults])

  return (
    <>
      <CredentialTabs
        platformId={platform.id}
        platform={platform}
        plan={plan}
        planCreds={planCreds}
        takenNames={takenNames}
        selectedKeyId={activeKeyId}
        onSelectKey={onSelectKey}
        adding={adding}
        onStartAdd={() => setAdding(true)}
        onDoneAdd={closeAdd}
        pendingOverrides={pendingOverrides}
        extraDirty={extraDirty}
        onSaveExtras={onSaveExtras}
      />
      <div className="rounded-lg border border-border p-3">
        <PlatformModelsPanel
          platform={platform}
          plan={plan}
          selectedKeyId={activeKeyId}
        />
      </div>
      <AdvancedConfigSection
        platform={platform}
        plan={plan}
        planCreds={planCreds}
        selectedKeyId={activeKeyId}
        pending={adding || planCreds.length === 0}
        pendingOverrides={pendingOverrides}
        onPendingOverridesChange={setPendingOverrides}
      />
    </>
  )
}

// --- advanced config (model mapping + env) -----------------------------------

function AdvancedConfigSection({
  platform,
  plan,
  planCreds,
  selectedKeyId,
  pending,
  pendingOverrides,
  onPendingOverridesChange,
}: {
  platform: Platform
  plan: Plan
  planCreds: Credential[]
  selectedKeyId: string
  pending: boolean
  pendingOverrides: Record<string, EndpointOverride>
  onPendingOverridesChange: (v: Record<string, EndpointOverride>) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = planCreds.find((c) => c.id === selectedKeyId) ?? planCreds[0]
  const isCustom = isCustomPlatform(platform)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold">{t('resources.providers.advanced')}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        (pending ? (
          // A key being created has no credential to write through yet, so its overrides stay in the
          // parent's draft and every endpoint is shown at once.
          <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3">
            <OverridesEditor
              platform={platform}
              plan={plan}
              siteRoot={plan.baseUrl}
              value={pendingOverrides}
              onChange={onPendingOverridesChange}
            />
          </div>
        ) : (
          <EndpointConfigSection
            key={`${selected?.id ?? 'no-key'}:${(selected?.endpoints ?? []).map((e) => e.baseUrl).join('|')}`}
            platform={platform}
            plan={plan}
            credential={selected}
          />
        ))}
    </div>
  )
}

// --- platform detail ---------------------------------------------------------

function PlatformDetail({ platform }: { platform: Platform }) {
  const { t } = useTranslation()
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const deleteCustomPlatform = useSettingsStore((s) => s.deleteCustomPlatform)
  const updateCustomPlatform = useSettingsStore((s) => s.updateCustomPlatform)
  const isDark = useIsDark()
  const isCustom = isCustomPlatform(platform)
  const variantLabel = platformVariantLabel(platform, platforms)
  // Most-used plan first, so a user whose keys all live on one endpoint lands there instead of on
  // whichever plan the registry happens to list first.
  const orderedPlans = useMemo(() => plansByKeyCount(platform, credentials), [platform, credentials])
  const [planId, setPlanId] = useState(() => orderedPlans[0]?.id ?? '')
  const selectedPlan = orderedPlans.find((p) => p.id === planId) ?? orderedPlans[0]
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const [name, setName] = useState(platform.name)
  const [storedName, setStoredName] = useState(platform.name)
  if (platform.name !== storedName) {
    setStoredName(platform.name)
    setName(platform.name)
  }
  const nameDirty = name.trim() !== '' && name.trim() !== platform.name
  const iconSourceUrl = useMemo(() => {
    if (!selectedPlan) return ''
    const cred =
      credentials.find((c) => c.id === selectedKeyId) ??
      credentials.find((c) => c.platformId === platform.id && c.planId === selectedPlan.id)
    return siteRootOf(cred?.baseUrl || selectedPlan.baseUrl)
  }, [credentials, selectedKeyId, platform.id, selectedPlan])

  const commitName = useCallback(async () => {
    const next = name.trim()
    if (!next) {
      setName(platform.name)
      setEditingName(false)
      return
    }
    if (next !== platform.name) {
      await updateCustomPlatform({ ...platform, name: next })
    }
    setEditingName(false)
  }, [name, platform, updateCustomPlatform])

  const startEditName = useCallback(() => {
    setName(platform.name)
    setEditingName(true)
  }, [platform.name])

  const cancelEditName = useCallback(() => {
    setName(platform.name)
    setEditingName(false)
  }, [platform.name])

  const refreshIcon = useCallback(async () => {
    if (!iconSourceUrl || iconBusy) return
    setIconBusy(true)
    try {
      const identity = await window.app.resolveSiteIdentity(iconSourceUrl, isDark, true)
      if (identity.icon && identity.icon !== platform.icon) {
        await updateCustomPlatform({ ...platform, icon: identity.icon })
      }
    } finally {
      setIconBusy(false)
    }
  }, [iconSourceUrl, iconBusy, isDark, platform, updateCustomPlatform])

  const iconButton = (
    <button
      type="button"
      className="shrink-0 cursor-pointer rounded-sm outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      onClick={() => void refreshIcon()}
      disabled={iconBusy || !iconSourceUrl}
      title={t('resources.providers.refreshIcon')}
      aria-label={t('resources.providers.refreshIcon')}
    >
      {iconBusy ? (
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      ) : (
        <ProviderLabel brandKey={platform.brand} fallback={platform.name} icon={platform.icon} iconOnly size={28} />
      )}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex min-w-0 items-center gap-2">
            {isCustom ? (
              <>
                {iconButton}
                {editingName ? (
                  <Input
                    className="h-8 min-w-0 flex-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') cancelEditName()
                    }}
                    placeholder={t('resources.providers.platformName')}
                    aria-label={t('resources.providers.platformName')}
                    autoFocus
                  />
                ) : (
                  <span className="truncate text-sm font-medium">{platform.name}</span>
                )}
                {!editingName && (
                  <IconButton size="sm" tooltip={t('common.edit')} onClick={startEditName}>
                    <Pencil />
                  </IconButton>
                )}
              </>
            ) : (
              <ProviderLabel brandKey={platform.brand} fallback={platform.name} icon={platform.icon} combine size={28} />
            )}
            {variantLabel && <Badge variant="secondary">{variantLabel}</Badge>}
          </span>
          {orderedPlans.length > 1 && (
            <span className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
              {orderedPlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => {
                    setPlanId(plan.id)
                    setSelectedKeyId('')
                  }}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    plan.id === selectedPlan?.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {plan.name}
                </button>
              ))}
            </span>
          )}
        </span>
        {isCustom && (
          <IconButton size="sm" variant="destructive" onClick={() => void deleteCustomPlatform(platform.id)}>
            <Trash2 />
          </IconButton>
        )}
      </div>
      {(selectedPlan?.description ?? platform.description) && (
        <p className="text-sm text-muted-foreground">{selectedPlan?.description ?? platform.description}</p>
      )}

      {selectedPlan && (
        <PlanSection
          key={selectedPlan.id}
          platform={platform}
          plan={selectedPlan}
          selectedKeyId={selectedKeyId}
          onSelectKey={setSelectedKeyId}
          extraDirty={isCustom && nameDirty}
          onSaveExtras={isCustom ? commitName : undefined}
        />
      )}
    </div>
  )
}

// --- custom platform dialog --------------------------------------------------

// --- page --------------------------------------------------------------------

export function ProvidersPage() {
  const { t } = useTranslation()
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const setProviderScope = useSettingsStore((s) => s.setProviderScope)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)


  // Follow the sidebar host: remote connection id → node provider store.
  useEffect(() => {
    const next =
      selectedHostConnectionId && selectedHostConnectionId !== 'local'
        ? selectedHostConnectionId
        : 'local'
    if (next !== providerScope) setProviderScope(next)
  }, [selectedHostConnectionId, providerScope, setProviderScope])

  useEffect(() => { void fetchProviderData() }, [fetchProviderData, providerScope])

  const selectPlatform = useCallback((id: string) => {
    setSelectedId(id)
    setAdding(false)
  }, [])

  const claudeAccount = useChatStore((s) => s.harnessResources.claude?.account)
  const officials = platforms.filter(isOfficial)
  const rest = platforms.filter((p) => !isOfficial(p))
  const brandGroups = useMemo(
    () => [...platformsByBrand(rest)].sort((a, b) => brandRank(a.brand) - brandRank(b.brand)),
    [rest],
  )
  const credCount = useCallback(
    (platformId: string) => credentials.filter((c) => c.platformId === platformId).length,
    [credentials],
  )

  // A provider is "enabled" once it is usable: a non-official with at least one key, a signed-in
  // Claude account, or Codex (a built-in harness with no cheap local sign-in signal, so always on).
  const isEnabled = useCallback(
    (p: Platform): boolean => {
      if (isOfficial(p)) {
        if (officialHarness(p) === 'codex') return true
        return !!(claudeAccount?.email || claudeAccount?.subscriptionType)
      }
      return credCount(p.id) > 0
    },
    [claudeAccount, credCount],
  )
  // Officials first, then non-officials by brand popularity — order preserved within each bucket.
  const ordered = useMemo(
    () => [...officials, ...brandGroups.flatMap((g) => g.platforms)],
    [officials, brandGroups],
  )
  const enabledPlatforms = ordered.filter(isEnabled)
  const disabledPlatforms = ordered.filter((p) => !isEnabled(p))

  const selected = platforms.find((p) => p.id === selectedId) ?? null

  const renderRow = (p: Platform) => (
    <PlatformRow
      key={p.id}
      platform={p}
      selected={selectedId === p.id}
      onClick={() => selectPlatform(p.id)}
      count={isOfficial(p) ? 0 : credCount(p.id)}
      variantLabel={platformVariantLabel(p, platforms)}
    />
  )

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('resources.providers.title')}</h2>
          <IconButton
            size="md"
            tooltip={t('resources.providers.addCustom')}
            onClick={() => { setAdding(true); setSelectedId(null) }}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>

        {enabledPlatforms.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('resources.providers.enabled')}
            </div>
            {enabledPlatforms.map(renderRow)}
          </div>
        )}

        {disabledPlatforms.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('resources.providers.disabled')}
            </div>
            {disabledPlatforms.map(renderRow)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto px-1 py-1">
        {adding ? (
          <CustomPlatformForm onDone={(id) => { setAdding(false); if (id) setSelectedId(id) }} />
        ) : selected ? (
          isOfficial(selected) ? (
            <OfficialProviderPanel harness={officialHarness(selected)} />
          ) : (
            <PlatformDetail key={selected.id} platform={selected} />
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('resources.providers.selectHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function PlatformRow({
  platform,
  selected,
  onClick,
  count,
  variantLabel,
}: {
  platform: Platform
  selected: boolean
  onClick: () => void
  count: number
  variantLabel?: string | null
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-muted/50',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ProviderLabel brandKey={platform.brand} fallback={platform.name} icon={platform.icon} combine size={24} />
        {variantLabel && (
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[9px] font-normal">
            {variantLabel}
          </Badge>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {count > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {t('resources.providers.keyCount', { count })}
          </span>
        )}
      </span>
    </button>
  )
}
