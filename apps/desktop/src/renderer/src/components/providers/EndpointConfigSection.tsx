import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import {
  applyCapabilitiesToPlan,
  customEndpointsFor,
  endpointIdFor,
  FAMILY_PROTOCOLS,
  isCustomPlatform,
  mergeEndpoint,
  planCapabilities,
  PROTOCOL_FAMILIES,
  protocolRoute,
  type Credential,
  type EndpointOverride,
  type Plan,
  type Platform,
  type ProtocolFamily,
  type ServiceEndpoint,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { useSettingsStore } from '@/stores/settings'
import {
  EndpointOverrideFields,
  endpointsAsOverrideMap,
  pruneOverrides,
  type EndpointTestContext,
} from './CredentialConfig'
import { FAMILY_LABEL_KEY, PROTOCOL_LABEL_KEY } from './protocol-labels'

/**
 * One row of the endpoint dropdown.
 *
 * `key` is what the dropdown selects on and `endpointId` is what the config belongs to — they differ
 * for a custom platform, where several non-video protocols of a family share one endpoint. Selecting
 * `openai-images` and `openai-chat` therefore lands on the same base URL / env / mapping, which the
 * panel says out loud rather than letting the user discover by editing one and changing both.
 */
interface EndpointItem {
  key: string
  label: string
  route: string
  endpointId: string
  family: ProtocolFamily
  /** Custom platforms only: the protocol this row toggles. Builtin rows are not switchable. */
  protocol?: WireProtocol
}

function builtinItems(endpoints: ServiceEndpoint[], labelOf: (p: WireProtocol) => string): EndpointItem[] {
  return endpoints.map((endpoint) => ({
    key: endpoint.id,
    label: endpoint.protocols.map(labelOf).join(' · '),
    route: endpoint.protocols.map(protocolRoute).join(' · '),
    endpointId: endpoint.id,
    family: 'openai' as ProtocolFamily,
  }))
}

function customItems(labelOf: (p: WireProtocol) => string): EndpointItem[] {
  return PROTOCOL_FAMILIES.flatMap((family) =>
    FAMILY_PROTOCOLS[family].map((protocol) => ({
      key: protocol,
      label: labelOf(protocol),
      route: protocolRoute(protocol),
      endpointId: endpointIdFor(protocol),
      family,
      protocol,
    })),
  )
}

/**
 * Endpoint configuration for one credential: a dropdown to pick an endpoint, then that endpoint's
 * settings alone.
 *
 * Replaces a stack that rendered every endpoint's base URL / model mapping / env vars at once, plus a
 * separate protocol checkbox grid — three controls describing one thing. Builtin and custom platforms
 * share this: the only difference is that a custom platform's rows carry an enable switch, since its
 * endpoint list is derived from the protocols the user says the relay speaks.
 */
export function EndpointConfigSection({
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
  const isCustom = isCustomPlatform(platform)
  const labelOf = useCallback((p: WireProtocol) => t(PROTOCOL_LABEL_KEY[p]), [t])

  const keyEndpoints = credential?.endpoints?.length ? credential.endpoints : plan.endpoints
  const editPlan = useMemo(() => ({ ...plan, endpoints: keyEndpoints }), [plan, keyEndpoints])
  const siteRoot = credential?.baseUrl || plan.baseUrl

  const [enabled, setEnabled] = useState<Set<WireProtocol>>(
    () => new Set(planCapabilities(editPlan).protocols),
  )
  const [draft, setDraft] = useState<Record<string, EndpointOverride>>(() => {
    if (isCustom && credential?.endpoints?.length) return endpointsAsOverrideMap(credential.endpoints)
    return credential?.overrides ?? {}
  })
  const [busy, setBusy] = useState(false)

  const items = useMemo(
    () => (isCustom ? customItems(labelOf) : builtinItems(plan.endpoints, labelOf)),
    [isCustom, plan.endpoints, labelOf],
  )
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    const firstEnabled = items.find((i) => !i.protocol || enabled.has(i.protocol))
    return (firstEnabled ?? items[0])?.key ?? ''
  })
  const selected = items.find((i) => i.key === selectedKey) ?? items[0]

  // The endpoint the selected row configures — derived live so a protocol that was just enabled
  // already has an endpoint to edit, and so a switched-off one still surfaces its archived settings.
  const derivedEndpoints = useMemo(
    () =>
      isCustom
        ? applyCapabilitiesToPlan(editPlan, { protocols: [...enabled] })
        : plan.endpoints,
    [isCustom, editPlan, enabled, plan.endpoints],
  )
  // A protocol that was never switched on has neither a live nor an archived endpoint, so one is
  // derived on the fly — otherwise picking it from the dropdown shows an empty panel and there is no
  // way to configure an endpoint before enabling it.
  const targetEndpoint = useMemo(() => {
    const existing = derivedEndpoints.find((e) => e.id === selected?.endpointId)
    if (existing || !selected?.protocol) return existing
    return customEndpointsFor([selected.protocol]).find((e) => e.id === selected.endpointId)
  }, [derivedEndpoints, selected])
  const sharedWith = selected
    ? items.filter((i) => i.endpointId === selected.endpointId && i.key !== selected.key && (!i.protocol || enabled.has(i.protocol)))
    : []

  const testContext = useMemo<EndpointTestContext | undefined>(
    () => (credential ? { apiKey: '', credentialId: credential.id, canTest: true } : undefined),
    [credential],
  )

  const save = useCallback(async () => {
    if (!credential) return
    setBusy(true)
    try {
      if (isCustom) {
        const next = applyCapabilitiesToPlan(editPlan, { protocols: [...enabled] }).map((e) => {
          const ov = draft[e.id]
          if (!ov) return e
          const layered = mergeEndpoint(e, ov)
          const merged: ServiceEndpoint = {
            ...e,
            models: ov.models ?? e.models,
            defaults: {
              ...(e.defaults ?? {}),
              ...(ov.extraEnv ? { extraEnv: ov.extraEnv } : {}),
              ...(ov.modelMapping ? { modelMapping: ov.modelMapping } : {}),
            },
          }
          if (layered.baseUrl) merged.baseUrl = layered.baseUrl
          else delete merged.baseUrl
          if (layered.routes) merged.routes = layered.routes
          else delete merged.routes
          if (!merged.defaults?.extraEnv && !merged.defaults?.modelMapping) delete merged.defaults
          return merged
        })
        await updateCredential(credential.id, { endpoints: next, overrides: {} })
        return
      }
      await updateCredential(credential.id, { overrides: pruneOverrides(draft) })
    } finally {
      setBusy(false)
    }
  }, [credential, isCustom, editPlan, enabled, siteRoot, draft, updateCredential])

  if (!credential) {
    return <p className="text-xs text-muted-foreground">{t('resources.providers.capabilitiesNeedKey')}</p>
  }
  if (!selected) return null

  const selectedEnabled = !selected.protocol || enabled.has(selected.protocol)

  return (
    <div className="flex flex-col gap-2.5">
      {/* The enable switch sits beside the trigger rather than inside it: it is the endpoint's state,
          which the row already names, and nesting it would make toggling also open the menu. */}
      <div className="flex items-center gap-1 rounded-md border border-border pr-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-accent/40"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-medium">{selected.label}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground/70">{selected.route}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
            {PROTOCOL_FAMILIES.filter((f) => items.some((i) => i.family === f)).map((family) => (
              <div key={family}>
                {isCustom && <DropdownMenuLabel className="text-[10px] text-muted-foreground">{t(FAMILY_LABEL_KEY[family])}</DropdownMenuLabel>}
                {items
                  .filter((i) => i.family === family)
                  .map((item) => {
                    const on = !item.protocol || enabled.has(item.protocol)
                    return (
                      <DropdownMenuItem key={item.key} onSelect={() => setSelectedKey(item.key)} className="gap-2">
                        <Check className={cn('size-3.5 shrink-0', on ? 'opacity-100' : 'opacity-0')} />
                        <span className={cn('truncate', !on && 'text-muted-foreground')}>{item.label}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">{item.route}</span>
                      </DropdownMenuItem>
                    )
                  })}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {isCustom && selected.protocol && (
          <Switch
            aria-label={t('resources.providers.enableEndpoint')}
            checked={selectedEnabled}
            onCheckedChange={(on) =>
              setEnabled((prev) => {
                const next = new Set(prev)
                if (on) next.add(selected.protocol!)
                else next.delete(selected.protocol!)
                return next
              })
            }
          />
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
        {targetEndpoint ? (
          <>
            {!selectedEnabled && (
              <p className="text-[11px] text-muted-foreground">{t('resources.providers.endpointDisabledHint')}</p>
            )}
            {sharedWith.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {t('resources.providers.endpointSharedWith', { protocols: sharedWith.map((i) => i.label).join(', ') })}
              </p>
            )}
            <EndpointOverrideFields
              platform={platform}
              plan={editPlan}
              siteRoot={siteRoot}
              endpoint={targetEndpoint}
              showLabel={false}
              value={draft[targetEndpoint.id] ?? {}}
              onChange={(next) => setDraft((prev) => ({ ...prev, [targetEndpoint.id]: next }))}
              testContext={testContext}
            />
          </>
        ) : null}
      </div>

      <Button size="sm" className="self-start" disabled={busy} onClick={save}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : t('common.save')}
      </Button>
    </div>
  )
}
