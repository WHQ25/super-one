import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Input } from '@superone/ui/components/ui/input'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import {
  customPlatformEndpoints,
  defaultOverridesForPlan,
  FAMILY_TASKS,
  PROTOCOL_FAMILIES,
  type CapabilityTask,
  type Credential,
  type EndpointDefaults,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ProtocolFamily,
} from '@superone/shared/platform-registry'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import { useSettingsStore } from '@/stores/settings'
import { platformsByBrand } from '@/lib/provider-resolve'
import { OfficialProviderPanel } from './OfficialProviderPanel'
import { ProviderLabel } from './ProviderLabel'
import { CredentialConfig, EnvEditor, ModelEnvEditor, OverridesEditor, pruneOverrides } from './providers/CredentialConfig'
import { PlatformModelsPanel } from './providers/PlatformModelsPanel'

function isCustomPlatform(platform: Platform): boolean {
  return platform.id.startsWith('custom:')
}

const BRAND_POPULARITY = [
  'anthropic',
  'openai',
  'gemini',
  'deepseek',
  'zhipu',
  'zai',
  'kimi',
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
  return all.filter((p) => p.brand === platform.brand).length > 1 ? platform.name : null
}

function isOfficial(platform: Platform): boolean {
  return platform.plans.some((p) => p.auth === 'oauth')
}

function officialHarness(platform: Platform): 'claude' | 'codex' {
  return platform.brand === 'openai' ? 'codex' : 'claude'
}

// --- credential row + add form -----------------------------------------------

function CredentialRow({ credential, onDelete }: { credential: Credential; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{credential.name}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {credential.secretEnv ? `$${credential.secretEnv}` : credential.secret || '—'}
        </span>
      </div>
      <IconButton size="sm" variant="destructive" onClick={onDelete}>
        <Trash2 />
      </IconButton>
    </div>
  )
}

function AddKeyForm({
  platformId,
  planId,
  pendingOverrides,
  takenNames,
  onDone,
}: {
  platformId: string
  planId: string
  pendingOverrides: Record<string, EndpointOverride>
  takenNames: string[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const createCredential = useSettingsStore((s) => s.createCredential)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const effectiveName = name.trim() || 'Key'
  const conflict = useMemo(
    () => takenNames.some((n) => n.toLowerCase() === effectiveName.toLowerCase()),
    [takenNames, effectiveName],
  )

  const submit = useCallback(async () => {
    if (conflict || (!name.trim() && !secret.trim())) return
    setBusy(true)
    try {
      const overrides = pruneOverrides(pendingOverrides)
      await createCredential({
        platformId,
        planId,
        name: effectiveName,
        secret: secret.trim(),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      })
      onDone()
    } finally {
      setBusy(false)
    }
  }, [conflict, name, secret, effectiveName, platformId, planId, pendingOverrides, createCredential, onDone])

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
      <div className="flex flex-col gap-1">
        <Input
          placeholder={t('resources.providers.keyLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={conflict}
        />
        {conflict && <span className="text-[11px] text-destructive">{t('resources.providers.keyNameConflict')}</span>}
      </div>
      <Input
        type="password"
        placeholder={t('resources.providers.apiKey')}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
        <Button size="sm" disabled={busy || conflict} onClick={submit}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : t('resources.providers.addKey')}
        </Button>
      </div>
    </div>
  )
}

// --- plan section (keys + advanced, shared draft state) ----------------------

function PlanSection({ platform, plan }: { platform: Platform; plan: Plan }) {
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

  const closeAdd = useCallback(() => {
    setAdding(false)
    setPendingOverrides(planDefaults)
  }, [planDefaults])

  return (
    <>
      <PlanCard
        platform={platform}
        plan={plan}
        planCreds={planCreds}
        takenNames={takenNames}
        adding={adding}
        onStartAdd={() => setAdding(true)}
        onDoneAdd={closeAdd}
        pendingOverrides={pendingOverrides}
      />
      <AdvancedConfigSection
        platform={platform}
        plan={plan}
        planCreds={planCreds}
        pending={adding || planCreds.length === 0}
        pendingOverrides={pendingOverrides}
        onPendingOverridesChange={setPendingOverrides}
      />
    </>
  )
}

function PlanCard({
  platform,
  plan,
  planCreds,
  takenNames,
  adding,
  onStartAdd,
  onDoneAdd,
  pendingOverrides,
}: {
  platform: Platform
  plan: Plan
  planCreds: Credential[]
  takenNames: string[]
  adding: boolean
  onStartAdd: () => void
  onDoneAdd: () => void
  pendingOverrides: Record<string, EndpointOverride>
}) {
  const { t } = useTranslation()
  const deleteCredential = useSettingsStore((s) => s.deleteCredential)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t('resources.providers.apiKeys')}</span>
        {plan.apiKeyUrl && (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            onClick={() => window.app.openExternalLink(plan.apiKeyUrl!)}
          >
            {t('resources.providers.getKey')}
            <ExternalLink className="size-3" />
          </button>
        )}
      </div>
      {planCreds.map((c) => (
        <CredentialRow key={c.id} credential={c} onDelete={() => void deleteCredential(c.id)} />
      ))}
      {adding ? (
        <AddKeyForm
          platformId={platform.id}
          planId={plan.id}
          pendingOverrides={pendingOverrides}
          takenNames={takenNames}
          onDone={onDoneAdd}
        />
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={onStartAdd}>
          <Plus className="size-4" /> {t('resources.providers.addKey')}
        </Button>
      )}
    </div>
  )
}

// --- advanced config (model mapping + env) -----------------------------------

function AdvancedConfigSection({
  platform,
  plan,
  planCreds,
  pending,
  pendingOverrides,
  onPendingOverridesChange,
}: {
  platform: Platform
  plan: Plan
  planCreds: Credential[]
  pending: boolean
  pendingOverrides: Record<string, EndpointOverride>
  onPendingOverridesChange: (v: Record<string, EndpointOverride>) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyId, setKeyId] = useState('')
  const selected = planCreds.find((c) => c.id === keyId) ?? planCreds[0]

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
          <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3">
            <OverridesEditor platform={platform} plan={plan} value={pendingOverrides} onChange={onPendingOverridesChange} />
          </div>
        ) : (
          <>
            {planCreds.length > 1 && (
              <Select value={selected?.id ?? ''} onValueChange={setKeyId}>
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {planCreds.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selected && <CredentialConfig key={selected.id} platform={platform} plan={plan} credential={selected} />}
          </>
        ))}
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
                  onClick={() => setPlanId(plan.id)}
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
      {platform.description && <p className="text-sm text-muted-foreground">{platform.description}</p>}

      {selectedPlan && <PlanSection key={selectedPlan.id} platform={platform} plan={selectedPlan} />}

      {selectedPlan && (
        <div className="rounded-lg border border-border p-3">
          <PlatformModelsPanel platform={platform} plan={selectedPlan} />
        </div>
      )}
    </div>
  )
}

// --- custom platform dialog --------------------------------------------------

const FAMILY_LABEL_KEY: Record<ProtocolFamily, string> = {
  anthropic: 'resources.providers.familyAnthropic',
  openai: 'resources.providers.familyOpenai',
  google: 'resources.providers.familyGoogle',
}

const TASK_LABEL_KEY: Record<CapabilityTask, string> = {
  chat: 'resources.providers.taskChat',
  image: 'resources.providers.taskImage',
  video: 'resources.providers.taskVideo',
  tts: 'resources.providers.taskTts',
  asr: 'resources.providers.taskAsr',
}

// Inline add-form rendered in the detail panel (not a modal). onDone(id) is called with the new
// platform id on success, or with no argument on cancel; the parent unmounts the form either way.
function CustomPlatformForm({ onDone }: { onDone: (createdId?: string) => void }) {
  const { t } = useTranslation()
  const createCustomPlatform = useSettingsStore((s) => s.createCustomPlatform)
  const createCredential = useSettingsStore((s) => s.createCredential)
  const [name, setName] = useState('')
  const [families, setFamilies] = useState<Set<ProtocolFamily>>(() => new Set(['anthropic']))
  const [baseUrl, setBaseUrl] = useState('')
  const [familyTasks, setFamilyTasks] = useState<Record<ProtocolFamily, Set<CapabilityTask>>>(() => ({
    anthropic: new Set(['chat']),
    openai: new Set(['chat']),
    google: new Set(['chat']),
  }))
  const [extraEnv, setExtraEnv] = useState<Record<string, string>>({})
  const [modelMapping, setModelMapping] = useState<ProviderModelEnv>({})
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const toggleFamily = useCallback((family: ProtocolFamily, checked: boolean) => {
    setFamilies((prev) => {
      const next = new Set(prev)
      if (checked) next.add(family)
      else next.delete(family)
      return next
    })
  }, [])

  const toggleTask = useCallback((family: ProtocolFamily, task: CapabilityTask, checked: boolean) => {
    setFamilyTasks((prev) => {
      const next = new Set(prev[family])
      if (checked) next.add(task)
      else next.delete(task)
      return { ...prev, [family]: next }
    })
  }, [])

  // Each selected format carries its own capabilities. A format with only chat (anthropic) contributes
  // ['chat'] implicitly and shows no sub-picker; multi-capability formats expose a nested checkbox group.
  const tasksByFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const f of PROTOCOL_FAMILIES) {
    if (!families.has(f)) continue
    const caps = FAMILY_TASKS[f]
    tasksByFamily[f] = caps.length > 1 ? caps.filter((task) => familyTasks[f].has(task)) : ['chat']
  }
  // Selected formats that expose more than chat get a capability picker, rendered below the API key.
  const capabilityFamilies = PROTOCOL_FAMILIES.filter((f) => families.has(f) && FAMILY_TASKS[f].length > 1)
  const hasExtraEnv = Object.keys(extraEnv).length > 0
  // Model mapping is a claude-harness concept, so it only attaches to the anthropic-messages endpoint.
  const hasModelMapping = families.has('anthropic') && Object.keys(modelMapping).length > 0
  const rawEndpoints = customPlatformEndpoints(tasksByFamily, baseUrl.trim())
  const endpoints = rawEndpoints.map((e) => {
    const defaults: EndpointDefaults = {}
    if (hasExtraEnv) defaults.extraEnv = extraEnv
    if (hasModelMapping && e.protocol === 'anthropic-messages') defaults.modelMapping = modelMapping
    return Object.keys(defaults).length > 0 ? { ...e, defaults } : e
  })
  const canSubmit = !!name.trim() && !!baseUrl.trim() && endpoints.length > 0

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const id = `custom:${crypto.randomUUID()}`
      const platform: Platform = {
        id,
        brand: 'custom',
        name: name.trim(),
        plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints }],
      }
      await createCustomPlatform(platform)
      await createCredential({ platformId: id, planId: 'api', name: t('resources.providers.defaultKeyName'), secret: secret.trim() })
      onDone(id)
    } finally {
      setBusy(false)
    }
  }, [canSubmit, endpoints, name, secret, createCustomPlatform, createCredential, onDone, t])

  return (
    <div className="flex flex-col gap-4">
      <span className="text-base font-semibold">{t('resources.providers.addCustom')}</span>
      <div className="flex flex-col gap-3">
          <Input placeholder={t('resources.providers.customName')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder={t('resources.providers.baseUrl')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <Input
            type="password"
            placeholder={t('resources.providers.apiKey')}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <span className="text-xs text-muted-foreground">{t('resources.providers.formats')}</span>
            {PROTOCOL_FAMILIES.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <Checkbox checked={families.has(f)} onCheckedChange={(v) => toggleFamily(f, v === true)} />
                {t(FAMILY_LABEL_KEY[f])}
              </label>
            ))}
          </div>
          {capabilityFamilies.map((f) => (
            <div key={f} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <span className="text-xs text-muted-foreground">{t(FAMILY_LABEL_KEY[f])}</span>
              <div className="grid grid-cols-2 gap-2">
                {FAMILY_TASKS[f].map((task) => (
                  <label key={task} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={familyTasks[f].has(task)} onCheckedChange={(v) => toggleTask(f, task, v === true)} />
                    {t(TASK_LABEL_KEY[task])}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {families.has('anthropic') && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.modelMapping')}</span>
              <ModelEnvEditor value={modelMapping} onChange={setModelMapping} />
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => { void fetchProviderData() }, [fetchProviderData])

  const selectPlatform = useCallback((id: string) => {
    setSelectedId(id)
    setAdding(false)
  }, [])

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

  const selected = platforms.find((p) => p.id === selectedId) ?? null

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

        {officials.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('resources.providers.official')}
            </div>
            {officials.map((p) => (
              <PlatformRow
                key={p.id}
                platform={p}
                selected={selectedId === p.id}
                onClick={() => selectPlatform(p.id)}
                count={0}
                variantLabel={platformVariantLabel(p, platforms)}
              />
            ))}
          </div>
        )}

        {brandGroups.map((group) => (
          <div key={group.brand} className="flex flex-col gap-1">
            {group.platforms.map((p) => (
              <PlatformRow
                key={p.id}
                platform={p}
                selected={selectedId === p.id}
                onClick={() => selectPlatform(p.id)}
                count={credCount(p.id)}
                variantLabel={platformVariantLabel(p, platforms)}
              />
            ))}
          </div>
        ))}
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
