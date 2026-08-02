import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Input } from '@superone/ui/components/ui/input'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  applyCapabilitiesToPlan,
  capabilityEndpoints,
  cloneEndpoints,
  defaultOverridesForPlan,
  foldOverridesIntoEndpoints,
  isCustomPlatform,
  planCapabilities,
  type CapabilityTask,
  type Credential,
  type EndpointDefaults,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ProtocolFamily,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { platformsByBrand } from '@/lib/provider-resolve'
import { OfficialProviderPanel } from './OfficialProviderPanel'
import { ProviderLabel } from './ProviderLabel'
import { CapabilityPicker, TASK_LABEL_KEY, toPlanCapabilities, useCapabilityState } from './providers/CapabilityPicker'
import { CredentialConfig, EnvEditor, ModelEnvEditor, OverridesEditor } from './providers/CredentialConfig'
import { CredentialTabs } from './providers/CredentialTabs'
import { PlatformModelsPanel } from './providers/PlatformModelsPanel'
import {
  AddCustomModelPopover,
  endpointsSupportedTasks,
  upsertCustomModel,
  type CustomModel,
} from './providers/custom-models'
import { mergeDiscoveredIntoCustomModels } from './providers/discovery-apply'
import type { DiscoverState } from './providers/useModelDiscovery'
import { useEndpointTest } from './providers/test-endpoints'
import { TestConnectionButton, TestConnectionStatus } from './providers/TestConnection'

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
}: {
  platform: Platform
  plan: Plan
  selectedKeyId: string
  onSelectKey: (id: string) => void
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
      />
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
      {open && (
        <>
          {isCustom && (
            <CustomCapabilitiesSection
              key={selected?.id ?? 'no-key'}
              platform={platform}
              plan={plan}
              credential={selected}
            />
          )}
          {pending ? (
            <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3">
              <OverridesEditor platform={platform} plan={plan} value={pendingOverrides} onChange={onPendingOverridesChange} />
            </div>
          ) : (
            selected && <CredentialConfig key={selected.id} platform={platform} plan={plan} credential={selected} />
          )}
        </>
      )}
    </div>
  )
}

// --- platform detail ---------------------------------------------------------

function PlatformDetail({ platform }: { platform: Platform }) {
  const { t } = useTranslation()
  const platforms = useSettingsStore((s) => s.platforms)
  const deleteCustomPlatform = useSettingsStore((s) => s.deleteCustomPlatform)
  const isCustom = isCustomPlatform(platform)
  const variantLabel = platformVariantLabel(platform, platforms)
  const [planId, setPlanId] = useState(platform.plans[0]?.id ?? '')
  const selectedPlan = platform.plans.find((p) => p.id === planId) ?? platform.plans[0]
  const [selectedKeyId, setSelectedKeyId] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex shrink-0 items-center gap-2">
            <ProviderLabel brandKey={platform.brand} fallback={platform.name} combine size={28} />
            {variantLabel && <Badge variant="secondary">{variantLabel}</Badge>}
          </span>
          {platform.plans.length > 0 && (
            <span className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
              {platform.plans.map((plan) => (
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
        />
      )}

      {selectedPlan && (
        <div className="rounded-lg border border-border p-3">
          <PlatformModelsPanel
            platform={platform}
            plan={selectedPlan}
            selectedKeyId={selectedKeyId}
          />
        </div>
      )}
    </div>
  )
}

// --- custom platform dialog --------------------------------------------------

// Per-key capability editor: formats/tasks live on the selected credential.endpoints for custom platforms.
function CustomCapabilitiesSection({
  platform,
  plan,
  credential,
}: {
  platform: Platform
  plan: Plan
  credential?: Credential
}) {
  const { t } = useTranslation()
  const updateCredential = useSettingsStore((s) => s.updateCredential)
  const keyEndpoints = credential?.endpoints?.length ? credential.endpoints : plan.endpoints
  const seedPlan = useMemo(() => ({ ...plan, endpoints: keyEndpoints }), [plan, keyEndpoints])
  const initial = useMemo(() => planCapabilities(seedPlan), [seedPlan])
  const baseUrl = initial.baseUrl
  const { families, familyTasks, familyExtras, selection, toggleFamily, toggleTask, toggleExtra } = useCapabilityState(initial)
  const [busy, setBusy] = useState(false)

  const endpoints = applyCapabilitiesToPlan(seedPlan, toPlanCapabilities(selection), baseUrl)
  const dirty = JSON.stringify(keyEndpoints) !== JSON.stringify(endpoints)
  const canSave = !!credential && endpoints.length > 0 && dirty

  const save = useCallback(async () => {
    if (!canSave || !credential) return
    setBusy(true)
    try {
      await updateCredential(credential.id, { endpoints })
    } finally {
      setBusy(false)
    }
  }, [canSave, credential, endpoints, updateCredential])

  if (!credential) {
    return (
      <p className="text-xs text-muted-foreground">{t('resources.providers.capabilitiesNeedKey')}</p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-medium text-muted-foreground">{t('resources.providers.capabilities')}</span>
      <span className="text-[11px] text-muted-foreground">{t('resources.providers.capabilitiesPerKeyHint')}</span>
      <CapabilityPicker
        families={families}
        familyTasks={familyTasks}
        familyExtras={familyExtras}
        onToggleFamily={toggleFamily}
        onToggleTask={toggleTask}
        onToggleExtra={toggleExtra}
      />
      <Button size="sm" className="self-start" disabled={busy || !canSave} onClick={save}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : t('common.save')}
      </Button>
    </div>
  )
}

// Inline add-form rendered in the detail panel (not a modal). onDone(id) is called with the new
// platform id on success, or with no argument on cancel; the parent unmounts the form either way.
function CustomPlatformForm({ onDone }: { onDone: (createdId?: string) => void }) {
  const { t } = useTranslation()
  const createCustomPlatform = useSettingsStore((s) => s.createCustomPlatform)
  const createCredential = useSettingsStore((s) => s.createCredential)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const { families, familyTasks, familyExtras, selection, toggleFamily, toggleTask, toggleExtra } = useCapabilityState()
  const [extraEnv, setExtraEnv] = useState<Record<string, string>>({})
  const [modelMapping, setModelMapping] = useState<ProviderModelEnv>({})
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [keyName, setKeyName] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  // Each selected format carries its own capabilities (plus any opt-in extra wire like OpenAI Responses).
  // A format with only chat (anthropic) contributes ['chat'] implicitly and shows no sub-picker.
  const hasExtraEnv = Object.keys(extraEnv).length > 0
  // Model mapping is a claude-harness concept, so it only attaches to the anthropic-messages endpoint.
  const hasModelMapping = families.has('anthropic') && Object.keys(modelMapping).length > 0
  const rawEndpoints = capabilityEndpoints(toPlanCapabilities(selection), baseUrl.trim())
  const endpoints = rawEndpoints.map((e) => {
    const defaults: EndpointDefaults = {}
    if (hasExtraEnv) defaults.extraEnv = extraEnv
    if (hasModelMapping && e.protocols.includes('anthropic-messages')) defaults.modelMapping = modelMapping
    return Object.keys(defaults).length > 0 ? { ...e, defaults } : e
  })
  const supportedTasks = useMemo(() => endpointsSupportedTasks(endpoints), [endpoints])
  const canSubmit = !!name.trim() && !!baseUrl.trim() && endpoints.length > 0
  const { state: testState, run: runTest } = useEndpointTest()
  // Connection Test: main process probes one preferred auth surface (openai → google → anthropic).
  const test = useCallback(() => void runTest(endpoints, secret.trim()), [runTest, endpoints, secret])

  const [discoverState, setDiscoverState] = useState<DiscoverState>({ status: 'idle' })
  const runDiscover = useCallback(async () => {
    const trimmedBase = baseUrl.trim()
    if (!trimmedBase) return
    setDiscoverState({ status: 'loading' })
    try {
      const probe: ServiceEndpoint = { id: 'openai', baseUrl: trimmedBase, protocols: ['openai-chat'] }
      const result = await window.app.discoverProviderModels({ apiKey: secret.trim(), endpoint: probe })
      for (const m of result.models) {
        for (const [family, tasks] of Object.entries(m.byFamily) as [ProtocolFamily, CapabilityTask[]][]) {
          if (!tasks?.length) continue
          toggleFamily(family, true)
          for (const tk of tasks) toggleTask(family, tk, true)
        }
      }
      setCustomModels((prev) => mergeDiscoveredIntoCustomModels(prev, result.models))
      setDiscoverState({ status: 'done', truncated: result.truncated })
    } catch (err) {
      setDiscoverState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [baseUrl, secret, toggleFamily, toggleTask])

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const id = `custom:${crypto.randomUUID()}`
      // Plan keeps a seed template for "Add key"; the first credential owns the live endpoints.
      const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', endpoints: cloneEndpoints(endpoints) }
      const platform: Platform = { id, brand: 'custom', name: name.trim(), plans: [plan] }
      let overrides: Record<string, EndpointOverride> = {}
      for (const m of customModels) overrides = upsertCustomModel(overrides, plan, m)
      const keyEndpoints = foldOverridesIntoEndpoints(cloneEndpoints(endpoints), overrides)
      await createCustomPlatform(platform)
      await createCredential({
        platformId: id,
        planId: 'api',
        name: keyName.trim() || t('resources.providers.defaultKeyName'),
        secret: secret.trim(),
        endpoints: keyEndpoints,
      })
      onDone(id)
    } finally {
      setBusy(false)
    }
  }, [canSubmit, endpoints, customModels, name, keyName, secret, createCustomPlatform, createCredential, onDone, t])

  return (
    <div className="flex flex-col gap-4">
      <span className="text-base font-semibold">{t('resources.providers.addCustom')}</span>
      <div className="flex flex-col gap-3">
          <Input placeholder={t('resources.providers.customName')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder={t('resources.providers.baseUrl')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          {families.size > 1 && (
            <span className="text-xs text-muted-foreground">{t('resources.providers.relayHint')}</span>
          )}
          <Input placeholder={t('resources.providers.keyLabel')} value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <Input
            type="password"
            placeholder={t('resources.providers.apiKey')}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <CapabilityPicker
            families={families}
            familyTasks={familyTasks}
            familyExtras={familyExtras}
            onToggleFamily={toggleFamily}
            onToggleTask={toggleTask}
            onToggleExtra={toggleExtra}
          />
          {families.has('anthropic') && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.modelMapping')}</span>
              <ModelEnvEditor value={modelMapping} onChange={setModelMapping} />
            </div>
          )}
          {supportedTasks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.mediaModels')}</span>
                <AddCustomModelPopover
                  supportedTasks={supportedTasks}
                  existingIds={customModels.map((m) => m.id)}
                  onAdd={(m) => setCustomModels((prev) => [...prev, m])}
                />
              </div>
              {customModels.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{m.name || m.id}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{m.tasks.map((tk) => t(TASK_LABEL_KEY[tk])).join(' / ')}</span>
                  <IconButton size="sm" variant="destructive" onClick={() => setCustomModels((prev) => prev.filter((x) => x.id !== m.id))}>
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.environmentVariables')}</span>
            <EnvEditor value={extraEnv} onChange={setExtraEnv} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={busy || !canSubmit} onClick={submit}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('common.create')}
          </Button>
          <Button variant="ghost" onClick={() => onDone()}>{t('common.cancel')}</Button>
          <TestConnectionButton
            state={testState}
            onTest={test}
            size="default"
            disabled={!baseUrl.trim() || !secret.trim() || endpoints.length === 0}
          />
          <TestConnectionStatus state={testState} />
          <Button
            variant="outline"
            onClick={() => void runDiscover()}
            disabled={!baseUrl.trim() || !secret.trim() || discoverState.status === 'loading'}
          >
            {discoverState.status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t('resources.providerDialog.models.discover')}
          </Button>
          {discoverState.status === 'error' && (
            <span className="text-[11px] text-destructive">{t('resources.providerDialog.models.discoverError', { message: discoverState.message })}</span>
          )}
          {discoverState.status === 'done' && (
            <span className="text-[11px] text-success">
              {discoverState.truncated
                ? t('resources.providerDialog.models.discoverTruncated')
                : t('resources.providers.discoverModelsDone')}
            </span>
          )}
        </div>
    </div>
  )
}

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
        <ProviderLabel brandKey={platform.brand} fallback={platform.name} combine size={24} />
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
