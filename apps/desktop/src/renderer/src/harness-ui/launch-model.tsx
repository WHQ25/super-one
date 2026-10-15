import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { EffortLevel, HarnessId, ModelOption, SessionAgentProfile } from '@superone/shared/agent-types'
import { formatEffortOptionLabel } from '@superone/shared/effort-labels'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import {
  consumerForHarness,
  credentialsForConsumer,
  providerDisplayForCredential,
  resolveEffective,
} from '@/lib/provider-resolve'
import {
  GroupedModelEffortSelector,
  type SelectorCatalogParam,
  type SelectorEffortOption,
  type SelectorProviderOption,
} from '@/components/chat/model-selector/GroupedModelEffortSelector'
import { effortForLevels } from './effort'
import { apiKeyDefaultFor } from './api-key-defaults'
import { toSelectorModels } from './selector-models'

/**
 * Launch rows (collab launch confirm, automation confirm) configure a session that
 * does not exist yet. Each harness renders its own `LaunchModelControl` from these
 * props and reports edits through `onChange`; nothing here writes a chat session.
 */
export interface LaunchModelPatch {
  model?: string
  effort?: string
  apiProviderId?: string | null
  fastMode?: boolean
}

export interface LaunchModelProps {
  /** The agent's catalog: this machine's profile, or the target's for a remote launch. */
  profile: SessionAgentProfile | undefined
  /** `profile` reads only `profile`, for a machine this one's live caches do not describe. */
  catalog: 'local' | 'profile'
  /** ACP agent the launch runs, when the row knows it without a profile. */
  acpAgentId?: string | null
  apiProviderId: string | null | undefined
  model: string | null | undefined
  effort: string | null | undefined
  /** The row carries a Fast tier choice; harnesses with a Fast tier render its toggle. */
  offerFastMode?: boolean
  fastMode?: boolean
  /** The row cannot pick an API key (it runs on the user's default one): no provider list. */
  hideApiProvider?: boolean
  /** Extra Options rows the caller owns, e.g. an agent profile's harness settings. */
  optionParams?: SelectorCatalogParam[]
  onOptionParamChange?: (id: string, value: string) => void
  onChange: (patch: LaunchModelPatch) => void
}

const EMPTY_MODELS: ModelOption[] = []
const EMPTY_PLATFORMS: never[] = []
const EMPTY_CREDENTIALS: never[] = []
const EMPTY_BINDINGS: never[] = []

/** The profile's models as a catalog, the fallback until a live catalog arrives. */
export function useProfileCatalog(profile: SessionAgentProfile | undefined): ModelOption[] {
  const models = profile?.models
  return useMemo(
    () => models?.map((model) => ({ id: model.id, name: model.name, description: model.description ?? '' })) ?? EMPTY_MODELS,
    [models],
  )
}

export function liveOrProfile(live: ModelOption[], profileCatalog: ModelOption[]): ModelOption[] {
  return live.length > 0 ? live : profileCatalog
}

export function levelEffortOptions(levels: readonly string[]): SelectorEffortOption[] {
  return levels.map((level) => ({ value: level, label: formatEffortOptionLabel(level) }))
}

/** The profile's effort union narrowed to Claude-style levels. */
export function profileEffortLevels(profile: SessionAgentProfile | undefined): EffortLevel[] {
  return (profile?.efforts ?? []).filter((effort): effort is EffortLevel =>
    effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max')
}

export function effortLabel(
  options: SelectorEffortOption[],
  effort: string | null | undefined,
  format: (value: string) => string = formatEffortOptionLabel,
): string | null {
  return options.find((option) => option.value === effort)?.label ?? (effort ? format(effort) : null)
}

/**
 * Merge profile-declared API keys with live settings credentials for the harness.
 * Live settings win on id collisions so host-scoped remote keys stay current.
 */
export function mergeCollabProviders(args: {
  defaultBrand: string
  profileProviders: SessionAgentProfile['apiProviders']
  live: SelectorProviderOption[]
  defaultLabel: string
}): SelectorProviderOption[] {
  const byId = new Map<string, SelectorProviderOption>()
  for (const provider of args.profileProviders) {
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name,
      brand: provider.brand,
      keyName: provider.keyName,
    })
  }
  for (const provider of args.live) {
    if (provider.id == null) continue
    byId.set(provider.id, provider)
  }
  return [
    { id: null, brand: args.defaultBrand, name: args.defaultLabel },
    ...byId.values(),
  ]
}

/**
 * AI-provider (API key) choices for a harness that runs on third-party keys:
 * profile keys merged with this machine's live credentials, scoped to the
 * selected host. A profile-only launch offers the profile's keys alone.
 */
export function useLaunchProviders(args: {
  harnessId: HarnessId
  profile: SessionAgentProfile | undefined
  profileOnly: boolean
  apiProviderId: string | null | undefined
  hideApiProvider?: boolean
  onChange: (patch: LaunchModelPatch) => void
}) {
  const { harnessId, profile, profileOnly } = args
  const { t } = useTranslation()
  const builtIn = apiKeyDefaultFor(harnessId)
  const defaultBrand = builtIn.brand
  const defaultLabel = t(builtIn.labelKey)
  const platforms = useSettingsStore((s) => s.platforms) ?? EMPTY_PLATFORMS
  const credentials = useSettingsStore((s) => s.credentials) ?? EMPTY_CREDENTIALS
  const bindings = useSettingsStore((s) => s.bindings) ?? EMPTY_BINDINGS
  const providerScope = useSettingsStore((s) => s.providerScope)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const setProviderScope = useSettingsStore((s) => s.setProviderScope)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  const onChangeRef = useRef(args.onChange)
  onChangeRef.current = args.onChange

  useEffect(() => {
    if (typeof setProviderScope !== 'function') return
    const next = selectedHostConnectionId && selectedHostConnectionId !== 'local' ? selectedHostConnectionId : 'local'
    if (next !== providerScope) setProviderScope(next)
  }, [selectedHostConnectionId, providerScope, setProviderScope])

  useEffect(() => {
    if (profileOnly || typeof fetchProviderData !== 'function') return
    void fetchProviderData()
  }, [profileOnly, fetchProviderData, providerScope])

  const consumer = consumerForHarness(harnessId)
  const options = useMemo(() => ({ experimentalClaudeOpenAiChatEnabled }), [experimentalClaudeOpenAiChatEnabled])

  const live = useMemo<SelectorProviderOption[]>(() => {
    if (profileOnly) return []
    return credentialsForConsumer(platforms, credentials, consumer, options).map((credential) => {
      const { brand, name, icon } = providerDisplayForCredential(platforms, credential)
      return { id: credential.id, brand, name, icon, keyName: credential.name }
    })
  }, [consumer, profileOnly, platforms, credentials, options])

  const profileProviders = profile?.apiProviders
  const providers = useMemo(
    () => mergeCollabProviders({ defaultBrand, profileProviders: profileProviders ?? [], live, defaultLabel }),
    [defaultBrand, profileProviders, live, defaultLabel],
  )

  const selectedProviderId = args.apiProviderId ?? null
  const effective = useMemo(
    () => resolveEffective(platforms, credentials, bindings, consumer, selectedProviderId, options),
    [platforms, credentials, bindings, consumer, selectedProviderId, options],
  )

  return {
    effective,
    selector: args.hideApiProvider ? { selectedProviderId } : {
      providers,
      selectedProviderId,
      onSelectProvider: (id: string | null) => onChangeRef.current({ apiProviderId: id }),
      onManageProviders: () => {
        setSettingsTab?.('providers')
        navigateTo?.('settings')
      },
    },
  }
}

/**
 * The launch control for a harness whose catalog is a flat model list with
 * per-model effort levels (Cursor, dsh). Per-model levels are authoritative: a
 * model with none shows no chips, since `profile.efforts` is a union across
 * every model and would offer levels the picked model cannot run.
 */
export function FlatLaunchModel({ catalog, model, effort, optionParams, onOptionParamChange, onChange }: {
  catalog: ModelOption[]
  model: string | null | undefined
  effort: string | null | undefined
  onChange: (patch: LaunchModelPatch) => void
} & Pick<LaunchModelProps, 'optionParams' | 'onOptionParamChange'>) {
  const models = useMemo(() => toSelectorModels(catalog), [catalog])
  const selected = catalog.find((entry) => entry.id === model)
  const effortOptions = useMemo(() => levelEffortOptions(selected?.supportedEffortLevels ?? []), [selected])
  return (
    <GroupedModelEffortSelector
      models={models}
      selectedModelId={model ?? null}
      selectedModelLabel={models.find((entry) => entry.id === model)?.name ?? model ?? null}
      onSelectModel={(id) => {
        const next = effortForLevels(catalog.find((entry) => entry.id === id)?.supportedEffortLevels, effort)
        onChange({ model: id, ...(next ? { effort: next } : {}) })
      }}
      effortOptions={effortOptions}
      selectedEffort={effort ?? null}
      selectedEffortLabel={effortLabel(effortOptions, effort)}
      onSelectEffort={(value) => onChange({ effort: value })}
      optionParams={optionParams}
      onOptionParamChange={onOptionParamChange}
    />
  )
}
