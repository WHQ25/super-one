import { useCallback, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Input } from '@superone/ui/components/ui/input'
import {
  catalogProviderFor,
  defaultOverridesForPlan,
  isCustomPlatform,
  mergeEndpoint,
  protocolRequestUrl,
  protocolRoute,
  resolveEndpointModels,
  type Credential,
  type EndpointOverride,
  type Platform,
  type Plan,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'

import { useModelCatalog } from '@/hooks/useModelCatalog'
import { useSettingsStore } from '@/stores/settings'
import { collectOneMillionIds } from '@/lib/model-id'
import { ModelMappingField } from './ModelMappingField'
import { singleTestEndpoint, useEndpointTest } from './test-endpoints'
import { TestConnectionButton, TestConnectionStatus } from './TestConnection'

const RESERVED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
])

function parseEnvString(text: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    let trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !seen.has(key)) {
      seen.add(key)
      out.push({ key, value })
    }
  }
  return out
}

// --- env editor (Record<string,string>) --------------------------------------

export function EnvEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const { t } = useTranslation()
  const [pairs, setPairs] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(value).map(([key, v]) => ({ key, value: v })),
  )
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const sync = (next: Array<{ key: string; value: string }>) => {
    setPairs(next)
    const record: Record<string, string> = {}
    for (const p of next) if (p.key && !RESERVED_ENV_KEYS.has(p.key)) record[p.key] = p.value
    onChange(record)
  }

  const applyPaste = () => {
    const parsed = parseEnvString(pasteText).filter((p) => !RESERVED_ENV_KEYS.has(p.key))
    const existing = new Set(pairs.map((p) => p.key).filter(Boolean))
    sync([...pairs, ...parsed.filter((p) => !existing.has(p.key))])
    setPasteText('')
    setPasteOpen(false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="w-[40%] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pair.key}
            onChange={(e) => sync(pairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))}
            placeholder="KEY"
          />
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pair.value}
            onChange={(e) => sync(pairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
            placeholder="value"
          />
          <button
            type="button"
            onClick={() => sync(pairs.filter((_, j) => j !== i))}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPairs((prev) => [...prev, { key: '', value: '' }])}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" /> {t('resources.providerDialog.addVariable')}
        </button>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" /> {t('resources.providerDialog.pasteEnv')}
        </button>
      </div>
      {pasteOpen && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
          <textarea
            className="min-h-[72px] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="KEY1=value1&#10;export KEY2=value2"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setPasteOpen(false); setPasteText('') }}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={applyPaste}
              className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90"
            >
              {t('resources.providerDialog.applyPaste')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- per-endpoint override config --------------------------------------------

function isEmptyOverride(o: EndpointOverride): boolean {
  return !o.baseUrl && !o.routes && !o.models?.length && !o.extraEnv && !o.modelMapping
}

function pruneOverride(o: EndpointOverride): EndpointOverride {
  const out: EndpointOverride = {}
  if (o.baseUrl?.trim()) out.baseUrl = o.baseUrl.trim()
  if (o.routes && Object.keys(o.routes).length > 0) out.routes = o.routes
  const models = o.models?.filter((m) => m.id.trim())
  if (models && models.length > 0) out.models = models
  if (o.extraEnv && Object.keys(o.extraEnv).length > 0) out.extraEnv = o.extraEnv
  if (o.modelMapping && Object.keys(o.modelMapping).length > 0) out.modelMapping = o.modelMapping
  return out
}

/** Optional key context so each endpoint can be probed in isolation without siblings. */
export interface EndpointTestContext {
  apiKey: string
  credentialId?: string
  /** When false, hide the per-endpoint test control (e.g. no key typed yet). */
  canTest?: boolean
}

export function EndpointOverrideFields({
  platform,
  plan,
  siteRoot,
  endpoint,
  showLabel,
  value,
  onChange,
  testContext,
}: {
  platform: Platform
  plan: Plan
  /** The key's site root — `credential.baseUrl` when set, else `plan.baseUrl`. */
  siteRoot: string
  endpoint: ServiceEndpoint
  showLabel: boolean
  value: EndpointOverride
  onChange: (v: EndpointOverride) => void
  testContext?: EndpointTestContext
}) {
  const { t } = useTranslation()
  const { catalog } = useModelCatalog()
  const { state: testState, run: runTest } = useEndpointTest()
  const suggestions = useMemo(
    () => resolveEndpointModels(platform, plan, endpoint, catalog ?? undefined),
    [platform, plan, endpoint, catalog],
  )
  // Catalog ids with contextWindow >=1M, plus coding-plan preset base ids that ship with `[1m]`
  // (e.g. k3 from k3[1m] — catalog only knows kimi-k3).
  const oneMillionIds = useMemo(() => {
    return collectOneMillionIds(
      catalogProviderFor(platform, plan, catalog ?? undefined)?.models ?? [],
      plan.endpoints.map((e) => e.defaults?.modelMapping),
    )
  }, [catalog, platform, plan])
  // The first-party Anthropic API uses native Claude models on the real endpoint —
  // model remapping and a compatible-endpoint override make no sense there.
  const isFirstPartyAnthropic = platform.id === 'anthropic'
  const isAnthropic = endpoint.protocols.includes('anthropic-messages')
  const planHasAnthropic = plan.endpoints.some((e) => e.protocols.includes('anthropic-messages'))
  const supportsModelMapping = isAnthropic || (endpoint.protocols.includes('openai-chat') && !planHasAnthropic)
  const canTest = !!testContext && (testContext.canTest !== false)
  const previewProtocol = endpoint.protocols[0]
  const previewUrl = previewProtocol
    ? protocolRequestUrl(siteRoot, mergeEndpoint(endpoint, value), previewProtocol)
    : ''

  const testThisEndpoint = useCallback(() => {
    if (!testContext) return
    void runTest(
      siteRoot,
      [singleTestEndpoint(endpoint, value)],
      testContext.apiKey,
      testContext.credentialId,
    )
  }, [testContext, runTest, siteRoot, endpoint, value])

  return (
    <div className="flex flex-col gap-3">
      {showLabel && (
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{endpoint.protocols.join(' · ')}</span>
      )}

      {/*
        One row per protocol: the path this endpoint answers on, relative to the platform's base URL.
        This is an override, not a second base — a vendor serving Claude at `/api/anthropic` and
        OpenAI at `/api/coding/paas/v4` off one host is the norm, and both are just routes.
      */}
      {!isFirstPartyAnthropic && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('resources.providers.endpointRoute')}</span>
          {endpoint.protocols.map((protocol) => (
            <div key={protocol} className="flex items-center gap-1.5">
              {endpoint.protocols.length > 1 && (
                <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground/70">{protocol}</span>
              )}
              <Input
                className="min-w-0 flex-1 font-mono text-xs"
                value={value.routes?.[protocol] ?? ''}
                onChange={(e) =>
                  onChange({ ...value, routes: { ...value.routes, [protocol]: e.target.value } })
                }
                placeholder={protocolRoute(protocol)}
              />
              {canTest && protocol === endpoint.protocols[0] && (
                <TestConnectionButton
                  state={testState}
                  onTest={testThisEndpoint}
                  label={t('resources.providerDialog.testEndpoint')}
                />
              )}
            </div>
          ))}
          {previewUrl ? (
            <span className="text-[10px] text-muted-foreground/70">{previewUrl}</span>
          ) : null}
          {canTest && <TestConnectionStatus state={testState} />}
        </div>
      )}

      {supportsModelMapping && !isFirstPartyAnthropic && (
        <ModelMappingField
          label={t('resources.providerDialog.modelMapping')}
          models={suggestions}
          oneMillionIds={oneMillionIds}
          value={value.modelMapping ?? {}}
          onChange={(v) => onChange({ ...value, modelMapping: v })}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t('resources.providerDialog.environmentVariables')}</span>
        <EnvEditor value={value.extraEnv ?? {}} onChange={(v) => onChange({ ...value, extraEnv: v })} />
      </div>
    </div>
  )
}

/** Prune a full overrides map, dropping empty per-endpoint overrides. */
export function pruneOverrides(value: Record<string, EndpointOverride>): Record<string, EndpointOverride> {
  const out: Record<string, EndpointOverride> = {}
  for (const [id, o] of Object.entries(value)) {
    const pruned = pruneOverride(o)
    if (!isEmptyOverride(pruned)) out[id] = pruned
  }
  return out
}

/** Controlled editor for a credential's per-endpoint overrides (no store writes). */
export function OverridesEditor({
  platform,
  plan,
  siteRoot,
  value,
  onChange,
  testContext,
}: {
  platform: Platform
  plan: Plan
  siteRoot: string
  value: Record<string, EndpointOverride>
  onChange: (v: Record<string, EndpointOverride>) => void
  testContext?: EndpointTestContext
}) {
  return (
    <div className="flex flex-col gap-4">
      {plan.endpoints.map((endpoint) => (
        <EndpointOverrideFields
          key={endpoint.id}
          platform={platform}
          plan={plan}
          siteRoot={siteRoot}
          endpoint={endpoint}
          showLabel={plan.endpoints.length > 1}
          value={value[endpoint.id] ?? {}}
          onChange={(next) => onChange({ ...value, [endpoint.id]: next })}
          testContext={testContext}
        />
      ))}
    </div>
  )
}

export function endpointsAsOverrideMap(endpoints: ServiceEndpoint[]): Record<string, EndpointOverride> {
  const out: Record<string, EndpointOverride> = {}
  for (const e of endpoints) {
    const ov: EndpointOverride = {}
    if (e.baseUrl) ov.baseUrl = e.baseUrl
    if (e.routes && Object.keys(e.routes).length > 0) ov.routes = { ...e.routes }
    if (e.models?.length) ov.models = e.models
    if (e.defaults?.extraEnv && Object.keys(e.defaults.extraEnv).length > 0) ov.extraEnv = e.defaults.extraEnv
    if (e.defaults?.modelMapping && Object.keys(e.defaults.modelMapping).length > 0) {
      ov.modelMapping = e.defaults.modelMapping
    }
    if (Object.keys(ov).length > 0) out[e.id] = ov
  }
  return out
}

export function CredentialConfig({ platform, plan, credential }: { platform: Platform; plan: Plan; credential: Credential }) {
  const updateCredential = useSettingsStore((s) => s.updateCredential)
  const isCustom = isCustomPlatform(platform)
  const editPlan = useMemo(() => {
    if (isCustom && credential.endpoints?.length) return { ...plan, endpoints: credential.endpoints }
    return plan
  }, [isCustom, credential.endpoints, plan])

  const [draft, setDraft] = useState<Record<string, EndpointOverride>>(() => {
    if (isCustom && credential.endpoints?.length) return endpointsAsOverrideMap(credential.endpoints)
    if (credential.overrides && Object.keys(credential.overrides).length > 0) return credential.overrides
    return defaultOverridesForPlan(plan)
  })

  const commit = useCallback(() => {
    if (isCustom) {
      const base = credential.endpoints?.length ? credential.endpoints : plan.endpoints
      // Re-apply editor fields onto the key's endpoint list (protocols stay on the key).
      const next = base.map((e) => {
        const ov = draft[e.id]
        if (!ov) return e
        const merged: ServiceEndpoint = {
          ...e,
          baseUrl: ov.baseUrl?.trim() || e.baseUrl,
          models: ov.models ?? e.models,
          defaults: {
            ...(e.defaults ?? {}),
            ...(ov.extraEnv ? { extraEnv: ov.extraEnv } : {}),
            ...(ov.modelMapping ? { modelMapping: ov.modelMapping } : {}),
          },
        }
        if (!merged.defaults?.extraEnv && !merged.defaults?.modelMapping) delete merged.defaults
        return merged
      })
      void updateCredential(credential.id, { endpoints: next, overrides: {} })
      return
    }
    void updateCredential(credential.id, { overrides: pruneOverrides(draft) })
  }, [draft, credential, plan.endpoints, isCustom, updateCredential])

  // Stored key resolves via credentialId in main; empty apiKey means "use stored secret".
  const testContext = useMemo<EndpointTestContext>(
    () => ({ apiKey: '', credentialId: credential.id, canTest: true }),
    [credential.id],
  )

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3" onBlur={commit}>
      <OverridesEditor
        platform={platform}
        plan={editPlan}
        siteRoot={credential.baseUrl || editPlan.baseUrl}
        value={draft}
        onChange={setDraft}
        testContext={testContext}
      />
    </div>
  )
}
