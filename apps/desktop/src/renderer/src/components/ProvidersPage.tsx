import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
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
  FAMILY_EXTRA_PROTOCOLS,
  FAMILY_TASK_PROTOCOL,
  FAMILY_TASKS,
  isCustomPlatform,
  PROTOCOL_FAMILIES,
  PROTOCOL_FAMILY,
  type CapabilityTask,
  type Credential,
  type EndpointDefaults,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ProtocolFamily,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { platformsByBrand } from '@/lib/provider-resolve'
import { OfficialProviderPanel } from './OfficialProviderPanel'
import { ProviderLabel } from './ProviderLabel'
import { CredentialConfig, EnvEditor, ModelEnvEditor, OverridesEditor, pruneOverrides } from './providers/CredentialConfig'
import { PlatformModelsPanel } from './providers/PlatformModelsPanel'
import {
  AddCustomModelPopover,
  endpointsSupportedTasks,
  upsertCustomModel,
  type CustomModel,
} from './providers/custom-models'
import { planTestEndpoints, useEndpointTest } from './providers/test-endpoints'
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
  return all.filter((p) => p.brand === platform.brand).length > 1 ? platform.name : null
}

function isOfficial(platform: Platform): boolean {
  return platform.plans.some((p) => p.auth === 'oauth')
}

function officialHarness(platform: Platform): 'claude' | 'codex' {
  return platform.brand === 'openai' ? 'codex' : 'claude'
}

// --- credential row + add form -----------------------------------------------

function CredentialRow({
  credential,
  plan,
  takenNames,
  onDelete,
}: {
  credential: Credential
  plan: Plan
  takenNames: string[]
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const updateCredential = useSettingsStore((s) => s.updateCredential)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(credential.name)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const { state: testState, run: runTest } = useEndpointTest()
  const test = useCallback(
    () => void runTest(planTestEndpoints(plan, credential.overrides), secret.trim(), credential.id),
    [runTest, plan, credential.overrides, credential.id, secret],
  )

  const effectiveName = name.trim() || credential.name
  // Other keys on the same platform, excluding this one — renaming to a sibling's name conflicts.
  const conflict = useMemo(
    () =>
      effectiveName.toLowerCase() !== credential.name.toLowerCase() &&
      takenNames.some((n) => n.toLowerCase() === effectiveName.toLowerCase()),
    [takenNames, effectiveName, credential.name],
  )

  const cancel = useCallback(() => {
    setEditing(false)
    setName(credential.name)
    setSecret('')
  }, [credential.name])

  // A blank secret input means "keep the stored key" — only send `secret` when the user typed a new one.
  const save = useCallback(async () => {
    if (conflict) return
    setBusy(true)
    try {
      await updateCredential(credential.id, {
        name: effectiveName,
        ...(secret.trim() ? { secret: secret.trim() } : {}),
      })
      setEditing(false)
      setSecret('')
    } finally {
      setBusy(false)
    }
  }, [conflict, credential.id, effectiveName, secret, updateCredential])

  if (editing) {
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
          placeholder={credential.secretEnv ? `$${credential.secretEnv}` : credential.secret || t('resources.providers.apiKey')}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-row items-center gap-2">
            <TestConnectionButton state={testState} onTest={test} />
            <TestConnectionStatus state={testState} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={busy || conflict} onClick={save}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{credential.name}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {credential.secretEnv ? `$${credential.secretEnv}` : credential.secret || '—'}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton size="sm" onClick={() => setEditing(true)}>
          <Pencil />
        </IconButton>
        <IconButton size="sm" variant="destructive" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  )
}

function AddKeyForm({
  platformId,
  planId,
  plan,
  pendingOverrides,
  takenNames,
  onDone,
}: {
  platformId: string
  planId: string
  plan: Plan
  pendingOverrides: Record<string, EndpointOverride>
  takenNames: string[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const createCredential = useSettingsStore((s) => s.createCredential)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const { state: testState, run: runTest } = useEndpointTest()
  const test = useCallback(
    () => void runTest(planTestEndpoints(plan, pendingOverrides), secret.trim()),
    [runTest, plan, pendingOverrides, secret],
  )

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
      <div className="flex items-center justify-between gap-2">
        <TestConnectionButton state={testState} onTest={test} disabled={!secret.trim()} />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
          <Button size="sm" disabled={busy || conflict} onClick={submit}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('resources.providers.addKey')}
          </Button>
        </div>
      </div>
      <TestConnectionStatus state={testState} />
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
        <CredentialRow
          key={c.id}
          credential={c}
          plan={plan}
          takenNames={takenNames}
          onDelete={() => void deleteCredential(c.id)}
        />
      ))}
      {adding ? (
        <AddKeyForm
          platformId={platform.id}
          planId={plan.id}
          plan={plan}
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
          {isCustom && <CustomCapabilitiesSection platform={platform} plan={plan} />}
          {pending ? (
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
      {(selectedPlan?.description ?? platform.description) && (
        <p className="text-sm text-muted-foreground">{selectedPlan?.description ?? platform.description}</p>
      )}

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

// Labels for opt-in extra wires (FAMILY_EXTRA_PROTOCOLS) rendered alongside a family's capability tasks.
const PROTOCOL_LABEL_KEY: Partial<Record<WireProtocol, string>> = {
  'openai-responses': 'resources.providers.protocolOpenaiResponses',
}

// Per-family task label overrides — OpenAI's chat task is the "Chat Completion" wire (paired with the
// "Chat Response" extra wire), whereas other families keep the generic TASK_LABEL_KEY.
const FAMILY_TASK_LABEL: Partial<Record<ProtocolFamily, Partial<Record<CapabilityTask, string>>>> = {
  openai: { chat: 'resources.providers.protocolOpenaiChatCompletion' },
}

const TASK_LABEL_KEY: Record<CapabilityTask, string> = {
  chat: 'resources.providers.taskChat',
  image: 'resources.providers.taskImage',
  video: 'resources.providers.taskVideo',
  tts: 'resources.providers.taskTts',
  asr: 'resources.providers.taskAsr',
}

type CapabilitySelection = {
  families: Set<ProtocolFamily>
  familyTasks: Record<ProtocolFamily, Set<CapabilityTask>>
  familyExtras: Record<ProtocolFamily, Set<WireProtocol>>
}

// Format + per-family capability/extra-wire selection state, shared by the create form and the post-create
// editor. A family's task set is seeded from `initial` when that family is present in the plan (empty is
// honored — e.g. an OpenAI endpoint speaking only Responses), otherwise it defaults to ['chat'] so a
// newly-checked format behaves like the create dialog (chat pre-selected).
function useCapabilityState(initial?: CapabilitySelection) {
  const [families, setFamilies] = useState<Set<ProtocolFamily>>(() => new Set(initial?.families ?? ['anthropic']))
  const [familyTasks, setFamilyTasks] = useState<Record<ProtocolFamily, Set<CapabilityTask>>>(() => {
    const base = {} as Record<ProtocolFamily, Set<CapabilityTask>>
    for (const f of PROTOCOL_FAMILIES) {
      base[f] =
        initial && initial.families.has(f) ? new Set(initial.familyTasks[f]) : new Set<CapabilityTask>(['chat'])
    }
    return base
  })
  const [familyExtras, setFamilyExtras] = useState<Record<ProtocolFamily, Set<WireProtocol>>>(() => {
    const base = {} as Record<ProtocolFamily, Set<WireProtocol>>
    for (const f of PROTOCOL_FAMILIES) base[f] = new Set(initial?.familyExtras[f] ?? [])
    return base
  })

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

  const toggleExtra = useCallback((family: ProtocolFamily, protocol: WireProtocol, checked: boolean) => {
    setFamilyExtras((prev) => {
      const next = new Set(prev[family])
      if (checked) next.add(protocol)
      else next.delete(protocol)
      return { ...prev, [family]: next }
    })
  }, [])

  return { families, familyTasks, familyExtras, toggleFamily, toggleTask, toggleExtra }
}

// Collapse the format + per-family capability selections into the tasksByFamily map endpoints derive from.
// A single-capability family (anthropic → chat) contributes ['chat'] implicitly with no sub-picker.
function deriveTasksByFamily({ families, familyTasks }: CapabilitySelection): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const out: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const f of PROTOCOL_FAMILIES) {
    if (!families.has(f)) continue
    const caps = FAMILY_TASKS[f]
    out[f] = caps.length > 1 ? caps.filter((task) => familyTasks[f].has(task)) : ['chat']
  }
  return out
}

// The opt-in extra wires (e.g. OpenAI Responses) picked per selected family.
function deriveExtraByFamily({ families, familyExtras }: CapabilitySelection): Partial<Record<ProtocolFamily, WireProtocol[]>> {
  const out: Partial<Record<ProtocolFamily, WireProtocol[]>> = {}
  for (const f of PROTOCOL_FAMILIES) {
    if (!families.has(f)) continue
    const picked = FAMILY_EXTRA_PROTOCOLS[f].filter((p) => familyExtras[f].has(p))
    if (picked.length > 0) out[f] = picked
  }
  return out
}

// Reverse of the derive helpers: recover the family + capability/extra selections (and shared base URL)
// from an existing custom plan's endpoints, so they can be re-edited after creation. A task is selected
// only when its own wire protocol is present — so an endpoint speaking only openai-responses recovers as
// Responses without spuriously checking chat/image.
function planCapabilities(plan: Plan): CapabilitySelection & { baseUrl: string } {
  const families = new Set<ProtocolFamily>()
  const familyTasks = {} as Record<ProtocolFamily, Set<CapabilityTask>>
  const familyExtras = {} as Record<ProtocolFamily, Set<WireProtocol>>
  for (const f of PROTOCOL_FAMILIES) {
    familyTasks[f] = new Set<CapabilityTask>()
    familyExtras[f] = new Set<WireProtocol>()
  }
  let baseUrl = ''
  for (const e of plan.endpoints) {
    const family = PROTOCOL_FAMILY[e.protocols[0]]
    families.add(family)
    for (const task of FAMILY_TASKS[family]) {
      const proto = FAMILY_TASK_PROTOCOL[family][task]
      if (proto && e.protocols.includes(proto)) familyTasks[family].add(task)
    }
    for (const p of FAMILY_EXTRA_PROTOCOLS[family]) {
      if (e.protocols.includes(p)) familyExtras[family].add(p)
    }
    if (!baseUrl) baseUrl = e.baseUrl
  }
  return { families, familyTasks, familyExtras, baseUrl }
}

// Formats checkbox group + a nested picker (capability tasks + opt-in extra wires) for every selected family
// that has more than one thing to pick.
function CapabilityPicker({
  families,
  familyTasks,
  familyExtras,
  onToggleFamily,
  onToggleTask,
  onToggleExtra,
}: {
  families: Set<ProtocolFamily>
  familyTasks: Record<ProtocolFamily, Set<CapabilityTask>>
  familyExtras: Record<ProtocolFamily, Set<WireProtocol>>
  onToggleFamily: (family: ProtocolFamily, checked: boolean) => void
  onToggleTask: (family: ProtocolFamily, task: CapabilityTask, checked: boolean) => void
  onToggleExtra: (family: ProtocolFamily, protocol: WireProtocol, checked: boolean) => void
}) {
  const { t } = useTranslation()
  const pickerFamilies = PROTOCOL_FAMILIES.filter(
    (f) => families.has(f) && (FAMILY_TASKS[f].length > 1 || FAMILY_EXTRA_PROTOCOLS[f].length > 0),
  )
  return (
    <>
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <span className="text-xs text-muted-foreground">{t('resources.providers.formats')}</span>
        {PROTOCOL_FAMILIES.map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm">
            <Checkbox checked={families.has(f)} onCheckedChange={(v) => onToggleFamily(f, v === true)} />
            {t(FAMILY_LABEL_KEY[f])}
          </label>
        ))}
      </div>
      {pickerFamilies.map((f) => (
        <div key={f} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <span className="text-xs text-muted-foreground">{t(FAMILY_LABEL_KEY[f])}</span>
          <div className="grid grid-cols-2 gap-2">
            {FAMILY_EXTRA_PROTOCOLS[f].map((protocol) => (
              <label key={protocol} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={familyExtras[f].has(protocol)}
                  onCheckedChange={(v) => onToggleExtra(f, protocol, v === true)}
                />
                {t(PROTOCOL_LABEL_KEY[protocol] ?? protocol)}
              </label>
            ))}
            {FAMILY_TASKS[f].map((task) => (
              <label key={task} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={familyTasks[f].has(task)} onCheckedChange={(v) => onToggleTask(f, task, v === true)} />
                {t(FAMILY_TASK_LABEL[f]?.[task] ?? TASK_LABEL_KEY[task])}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

// Post-create capability editor (a subsection of Advanced Settings): re-pick formats/tasks for an existing
// custom platform and persist the rebuilt endpoints, preserving each endpoint's defaults (extraEnv / claude
// model mapping) by id.
function CustomCapabilitiesSection({ platform, plan }: { platform: Platform; plan: Plan }) {
  const { t } = useTranslation()
  const updateCustomPlatform = useSettingsStore((s) => s.updateCustomPlatform)
  const initial = useMemo(() => planCapabilities(plan), [plan])
  const baseUrl = initial.baseUrl
  const { families, familyTasks, familyExtras, toggleFamily, toggleTask, toggleExtra } = useCapabilityState(initial)
  const [busy, setBusy] = useState(false)

  const selection = { families, familyTasks, familyExtras }
  const prevById = useMemo(() => new Map(plan.endpoints.map((e) => [e.id, e])), [plan.endpoints])
  const endpoints = customPlatformEndpoints(deriveTasksByFamily(selection), baseUrl, deriveExtraByFamily(selection)).map((e) => {
    const defaults = prevById.get(e.id)?.defaults
    return defaults ? { ...e, defaults } : e
  })
  const dirty = JSON.stringify(plan.endpoints) !== JSON.stringify(endpoints)
  const canSave = endpoints.length > 0 && dirty

  const save = useCallback(async () => {
    if (!canSave) return
    setBusy(true)
    try {
      const nextPlan: Plan = { ...plan, endpoints }
      const next: Platform = { ...platform, plans: platform.plans.map((p) => (p.id === plan.id ? nextPlan : p)) }
      await updateCustomPlatform(next)
    } finally {
      setBusy(false)
    }
  }, [canSave, endpoints, plan, platform, updateCustomPlatform])

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-medium text-muted-foreground">{t('resources.providers.capabilities')}</span>
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
  const { families, familyTasks, familyExtras, toggleFamily, toggleTask, toggleExtra } = useCapabilityState()
  const [extraEnv, setExtraEnv] = useState<Record<string, string>>({})
  const [modelMapping, setModelMapping] = useState<ProviderModelEnv>({})
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [keyName, setKeyName] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  // Each selected format carries its own capabilities (plus any opt-in extra wire like OpenAI Responses).
  // A format with only chat (anthropic) contributes ['chat'] implicitly and shows no sub-picker.
  const selection = { families, familyTasks, familyExtras }
  const hasExtraEnv = Object.keys(extraEnv).length > 0
  // Model mapping is a claude-harness concept, so it only attaches to the anthropic-messages endpoint.
  const hasModelMapping = families.has('anthropic') && Object.keys(modelMapping).length > 0
  const rawEndpoints = customPlatformEndpoints(deriveTasksByFamily(selection), baseUrl.trim(), deriveExtraByFamily(selection))
  const endpoints = rawEndpoints.map((e) => {
    const defaults: EndpointDefaults = {}
    if (hasExtraEnv) defaults.extraEnv = extraEnv
    if (hasModelMapping && e.protocols.includes('anthropic-messages')) defaults.modelMapping = modelMapping
    return Object.keys(defaults).length > 0 ? { ...e, defaults } : e
  })
  const supportedTasks = useMemo(() => endpointsSupportedTasks(endpoints), [endpoints])
  const canSubmit = !!name.trim() && !!baseUrl.trim() && endpoints.length > 0
  const { state: testState, run: runTest } = useEndpointTest()
  const test = useCallback(() => void runTest(endpoints.slice(0, 1), secret.trim()), [runTest, endpoints, secret])

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const id = `custom:${crypto.randomUUID()}`
      const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', endpoints }
      const platform: Platform = { id, brand: 'custom', name: name.trim(), plans: [plan] }
      let overrides: Record<string, EndpointOverride> = {}
      for (const m of customModels) overrides = upsertCustomModel(overrides, plan, m)
      await createCustomPlatform(platform)
      await createCredential({
        platformId: id,
        planId: 'api',
        name: keyName.trim() || t('resources.providers.defaultKeyName'),
        secret: secret.trim(),
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
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
