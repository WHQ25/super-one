import { useCallback, useRef, useState } from 'react'
import { ChevronDown, Globe, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { cn } from '@superone/ui/lib/utils'
import {
  capabilityEndpoints,
  cloneEndpoints,
  foldOverridesIntoEndpoints,
  relaySiteRoot,
  WIRE_PROTOCOLS,
  type EndpointDefaults,
  type EndpointOverride,
  type Plan,
  type Platform,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import type { DiscoverModelsResult, DiscoveredOpenAiModel, ProviderModelEnv } from '@superone/shared/agent-types'
import { useIsDark } from '@/hooks/use-is-dark'
import { useSettingsStore } from '@/stores/settings'
import { BrowserFavicon } from '../browser/BrowserFavicon'
import { CapabilityPicker, toPlanCapabilities, useCapabilityState } from './CapabilityPicker'
import { protocolsForDiscoveredSlots } from './discovery-apply'
import { EnvEditor, ModelEnvEditor } from './CredentialConfig'
import { upsertCustomModel } from './custom-models'
import { DraftDiscoveredModels } from './DraftDiscoveredModels'
import { baseUrlHasHost, ensureHttpsPrefix, identityKey } from './site-url'
import { useEndpointTest } from './test-endpoints'
import { TestConnectionButton, TestConnectionStatus } from './TestConnection'

const DEFAULT_LABEL = 'default'

/** Inline add-form for the detail panel. `onDone(id)` on success, `onDone()` on cancel. */
export function CustomPlatformForm({ onDone }: { onDone: (createdId?: string) => void }) {
  const { t } = useTranslation()
  const createCustomPlatform = useSettingsStore((s) => s.createCustomPlatform)
  const createCredential = useSettingsStore((s) => s.createCredential)
  const isDark = useIsDark()
  const [modelsOpen, setModelsOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const { protocols, selection, toggleProtocol } = useCapabilityState()
  const [extraEnv, setExtraEnv] = useState<Record<string, string>>({})
  const [modelMapping, setModelMapping] = useState<ProviderModelEnv>({})
  const [secret, setSecret] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [siteName, setSiteName] = useState<string | null>(null)
  const [siteIcon, setSiteIcon] = useState<string | null>(null)
  const [identityUrl, setIdentityUrl] = useState('')
  const [identityBusy, setIdentityBusy] = useState(false)
  const identityGen = useRef(0)
  const lastIdentityKey = useRef('')
  const identityPromise = useRef<Promise<void> | null>(null)
  const [busy, setBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draftModels, setDraftModels] = useState<DiscoveredOpenAiModel[]>([])
  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => new Set())

  const hasExtraEnv = Object.keys(extraEnv).length > 0
  const hasModelMapping = protocols.has('anthropic-messages') && Object.keys(modelMapping).length > 0
  const rawEndpoints = capabilityEndpoints(toPlanCapabilities(selection))
  const endpoints = rawEndpoints.map((e) => {
    const extra = { ...e.defaults?.extraEnv, ...(hasExtraEnv ? extraEnv : {}) }
    const mapping =
      hasModelMapping && e.protocols.includes('anthropic-messages')
        ? modelMapping
        : e.defaults?.modelMapping
    const defaults: EndpointDefaults = {}
    if (Object.keys(extra).length > 0) defaults.extraEnv = extra
    if (mapping && Object.keys(mapping).length > 0) defaults.modelMapping = mapping
    return Object.keys(defaults).length > 0 ? { ...e, defaults } : e
  })
  const displayName = nameInput.trim() || siteName?.trim() || DEFAULT_LABEL
  const canNext = baseUrlHasHost(baseUrl) && !!secret.trim()
  const canSubmit = canNext && endpoints.length > 0
  const { state: testState, run: runTest } = useEndpointTest()
  const test = useCallback(
    () => void runTest(baseUrl.trim(), endpoints, secret.trim()),
    [runTest, baseUrl, endpoints, secret],
  )

  const resetIdentity = useCallback(() => {
    identityGen.current += 1
    lastIdentityKey.current = ''
    identityPromise.current = null
    setIdentityUrl('')
    setSiteName(null)
    setSiteIcon(null)
    setIdentityBusy(false)
  }, [])

  const applyIdentity = useCallback((raw: string) => {
    const trimmed = raw.trim()
    const key = identityKey(trimmed)
    if (!key) {
      resetIdentity()
      return Promise.resolve()
    }
    if (lastIdentityKey.current === key) {
      return identityPromise.current ?? Promise.resolve()
    }

    const gen = ++identityGen.current
    lastIdentityKey.current = key
    setIdentityUrl(relaySiteRoot(trimmed) || trimmed)
    setIdentityBusy(true)
    const pending = (async () => {
      try {
        const identity = await window.app.resolveSiteIdentity(trimmed, isDark)
        if (gen !== identityGen.current) return
        setSiteIcon(identity.icon)
        setSiteName(identity.name)
      } catch {
        if (gen !== identityGen.current) return
        setSiteIcon(null)
        setSiteName(null)
      } finally {
        if (gen === identityGen.current) {
          setIdentityBusy(false)
          if (identityPromise.current === pending) identityPromise.current = null
        }
      }
    })()
    identityPromise.current = pending
    return pending
  }, [isDark, resetIdentity])

  const goNext = useCallback(() => {
    if (!canNext) return
    setModelsOpen(true)
    void applyIdentity(baseUrl)
  }, [baseUrl, canNext, applyIdentity])

  const applyDiscoverResult = useCallback((result: DiscoverModelsResult) => {
    const hasHits = result.models.length > 0 || (result.extras?.length ?? 0) > 0
    if (hasHits) {
      // Discovery reports an endpoint slot per model — a video wire names itself, a family slot names
      // the shared endpoint. Both map straight onto protocols now, with no capability round-trip.
      const wanted = new Set<WireProtocol>(protocolsForDiscoveredSlots(result.models, result.extras))
      for (const protocol of WIRE_PROTOCOLS) toggleProtocol(protocol, wanted.has(protocol))
    }
    setDraftModels(result.models)
    setEnabledIds((prev) => new Set([...prev].filter((id) => result.models.some((m) => m.id === id))))
  }, [toggleProtocol])

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const id = `custom:${crypto.randomUUID()}`
      const plan: Plan = { id: 'api', name: 'API', auth: 'api-key', baseUrl: baseUrl.trim(), endpoints: cloneEndpoints(endpoints) }
      const platform: Platform = {
        id,
        brand: 'custom',
        name: displayName,
        ...(siteIcon ? { icon: siteIcon } : {}),
        ...(draftModels.length > 0 ? { discoveredModels: draftModels } : {}),
        plans: [plan],
      }
      let overrides: Record<string, EndpointOverride> = {}
      for (const m of draftModels) {
        if (!enabledIds.has(m.id)) continue
        overrides = upsertCustomModel(overrides, plan, {
          id: m.id,
          name: m.name,
          tasks: m.tasks,
          byFamily: m.byFamily,
        })
      }
      const keyEndpoints = foldOverridesIntoEndpoints(cloneEndpoints(endpoints), overrides)
      await createCustomPlatform(platform)
      await createCredential({
        platformId: id,
        planId: 'api',
        name: DEFAULT_LABEL,
        secret: secret.trim(),
        baseUrl: baseUrl.trim(),
        endpoints: keyEndpoints,
      })
      onDone(id)
    } finally {
      setBusy(false)
    }
  }, [canSubmit, endpoints, draftModels, enabledIds, displayName, siteIcon, secret, createCustomPlatform, createCredential, onDone, t])

  return (
    <div className="flex flex-col gap-4">
      <span className="text-base font-semibold">{t('resources.providers.addCustom')}</span>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {identityBusy ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <BrowserFavicon
              url={identityUrl || undefined}
              src={siteIcon}
              preferSrc
              fallback={<Globe className="size-5 shrink-0 text-muted-foreground" />}
              className="size-5 shrink-0"
            />
          )}
          <Input
            className="flex-1"
            placeholder={siteName || t('resources.providers.customName')}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
        </div>
        <Input
          placeholder={t('resources.providers.baseUrl')}
          value={baseUrl}
          onChange={(e) => {
            const next = e.target.value
            setBaseUrl(next)
            const nextKey = identityKey(next)
            if (lastIdentityKey.current && nextKey !== lastIdentityKey.current) resetIdentity()
          }}
          onBlur={(e) => {
            const next = ensureHttpsPrefix(e.currentTarget.value)
            if (next !== baseUrl) setBaseUrl(next)
            if (baseUrlHasHost(next)) void applyIdentity(next)
            else resetIdentity()
          }}
        />
        <Input
          type="password"
          placeholder={t('resources.providers.apiKey')}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TestConnectionButton
            state={testState}
            onTest={test}
            size="default"
            disabled={!canNext || endpoints.length === 0}
          />
          <TestConnectionStatus state={testState} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={() => onDone()}>{t('common.cancel')}</Button>
          {modelsOpen ? (
            <Button disabled={busy || !canSubmit} onClick={submit}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : t('common.save')}
            </Button>
          ) : (
            <Button disabled={!canNext} onClick={goNext}>{t('common.next')}</Button>
          )}
        </div>
      </div>
      {modelsOpen && (
        <>
          <DraftDiscoveredModels
            key={`${baseUrl}:${secret}`}
            baseUrl={baseUrl}
            apiKey={secret}
            enabledIds={enabledIds}
            autoStart
            onToggle={(model, enabled) => {
              setEnabledIds((prev) => {
                const next = new Set(prev)
                if (enabled) next.add(model.id)
                else next.delete(model.id)
                return next
              })
            }}
            onBulkSet={(models, enabled) => {
              setEnabledIds((prev) => {
                const next = new Set(prev)
                for (const m of models) {
                  if (enabled) next.add(m.id)
                  else next.delete(m.id)
                }
                return next
              })
            }}
            onResult={applyDiscoverResult}
          />
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center justify-between gap-3 text-left"
            >
              <span className="text-sm font-semibold">{t('resources.providers.advanced')}</span>
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')} />
            </button>
            {advancedOpen && (
              <div className="flex flex-col gap-3">
                <CapabilityPicker protocols={protocols} onToggleProtocol={toggleProtocol} />
                {protocols.has('anthropic-messages') && (
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
            )}
          </div>
        </>
      )}
    </div>
  )
}
