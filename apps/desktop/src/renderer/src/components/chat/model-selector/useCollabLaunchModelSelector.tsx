import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  EffortLevel,
  HarnessId,
  ModelOption,
  ProviderModelEnv,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { findPlatform } from '@superone/shared/platform-registry'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import {
  brandOfCredential,
  consumerForHarness,
  credentialsForConsumer,
  resolveEffective,
} from '@/lib/provider-resolve'
import {
  groupModelsBySlashPrefix,
  resolveClaudeDisplayName,
  resolveClaudeEntries,
  resolveSlashModelLabel,
} from '../ModelSelectorLists'
import { formatCodexModelName, formatReasoningEffortLabel } from '../chat-input-utils'
import { FireText } from '../FireText'
import type {
  SelectorEffortOption,
  SelectorModelGroup,
  SelectorModelOption,
  SelectorProviderOption,
} from './GroupedModelEffortSelector'

export interface CollabModelConfigPatch {
  model?: string
  effort?: string
  apiProviderId?: string | null
}

const EMPTY_MODELS: ModelOption[] = []
const EMPTY_PLATFORMS: never[] = []
const EMPTY_CREDENTIALS: never[] = []
const EMPTY_BINDINGS: never[] = []

/** Same labels as ClaudeModelSelector / OpenCodeModelSelector. */
export const CLAUDE_EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

/** Compact ACP effort names: "High Effort" → "High" (matches AcpModelSelector). */
export function compactEffortLabel(name: string): string {
  return name.replace(/\s+Effort$/i, '').trim() || name
}

/** Claude / OpenCode effort chip labels; falls back to title-case id. */
export function formatClaudeStyleEffortLabel(value: string): string {
  if (value in CLAUDE_EFFORT_LABELS) {
    return CLAUDE_EFFORT_LABELS[value as EffortLevel]
  }
  return compactEffortLabel(value)
}

/**
 * Merge profile-declared API keys with live settings credentials for the harness.
 * Live settings win on id collisions so host-scoped remote keys stay current.
 */
export function mergeCollabProviders(args: {
  harnessId: HarnessId
  profileProviders: SessionAgentProfile['apiProviders']
  live: SelectorProviderOption[]
  defaultLabel: string
}): SelectorProviderOption[] {
  const defaultBrand = args.harnessId === 'codex'
    ? 'openai'
    : args.harnessId === 'claude'
      ? 'claude'
      : undefined
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
    { id: null, brand: defaultBrand, name: args.defaultLabel },
    ...byId.values(),
  ]
}

export function claudeModelsForProvider(
  catalog: ModelOption[],
  modelEnv: ProviderModelEnv | null | undefined,
): SelectorModelOption[] {
  const mapping = modelEnv && Object.keys(modelEnv).length > 0 ? modelEnv : null
  return resolveClaudeEntries(catalog, mapping).map(({ model, displayName, description }) => ({
    id: model.id,
    name: displayName,
    ...(description ? { description } : {}),
  }))
}

export function codexModelsToSelectorOptions(models: ModelOption[]): SelectorModelOption[] {
  return models.map((model) => ({
    id: model.id,
    name: formatCodexModelName(model.name, model.id),
    ...(model.description ? { description: model.description } : {}),
  }))
}

function profileModelsAsCatalog(profileModels: SessionAgentProfile['models']): ModelOption[] {
  return profileModels.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description ?? '',
  }))
}

function hasSlashModelIds(models: ModelOption[]): boolean {
  return models.some((model) => model.id.includes('/'))
}

/**
 * Model + AI-provider controls for one collab launch row.
 * Mirrors the main chat selectors (Claude / Codex / OpenCode / ACP) for labels,
 * model catalog, effort chips, and third-party keys — without writing the parent session.
 */
export function useCollabLaunchModelSelector(args: {
  harnessId: HarnessId
  profile: SessionAgentProfile | undefined
  apiProviderId: string | null | undefined
  selectedModelId: string | null | undefined
  selectedEffort: string | null | undefined
  onChange: (patch: CollabModelConfigPatch) => void
}): {
  models?: SelectorModelOption[]
  modelGroups?: SelectorModelGroup[]
  selectedModelId: string | null
  selectedModelLabel: string | null | undefined
  onSelectModel: (id: string) => void
  effortOptions: SelectorEffortOption[]
  selectedEffort: string | null
  selectedEffortLabel?: string | null
  onSelectEffort: (value: string) => void
  providers: SelectorProviderOption[]
  selectedProviderId: string | null
  onSelectProvider: (id: string | null) => void
  onManageProviders: () => void
  onRefreshModels?: () => void
  modelsLoading: boolean
  shouldCloseAfterModelSelect?: (id: string) => boolean
  triggerLabel?: ReactNode
} {
  const { t } = useTranslation()
  const { harnessId, profile, apiProviderId, selectedModelId, selectedEffort, onChange } = args

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
  const activeProject = useChatStore((s) => s.activeProject)
  const claudeCatalog = useChatStore((s) => s.harnessResources.claude?.models ?? EMPTY_MODELS)
  const openCodeCatalog = useChatStore((s) => s.harnessResources.opencode?.models ?? EMPTY_MODELS)

  const [codexModels, setCodexModels] = useState<ModelOption[]>([])
  const [codexLoading, setCodexLoading] = useState(false)
  const codexRequestId = useRef(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (typeof setProviderScope !== 'function') return
    const next =
      selectedHostConnectionId && selectedHostConnectionId !== 'local'
        ? selectedHostConnectionId
        : 'local'
    if (next !== providerScope) setProviderScope(next)
  }, [selectedHostConnectionId, providerScope, setProviderScope])

  useEffect(() => {
    if (typeof fetchProviderData !== 'function') return
    void fetchProviderData()
  }, [fetchProviderData, providerScope])

  const supportsProviders = harnessId === 'claude' || harnessId === 'codex'
  const consumer = supportsProviders ? consumerForHarness(harnessId) : null

  const liveProviders = useMemo<SelectorProviderOption[]>(() => {
    if (!consumer) return []
    return credentialsForConsumer(platforms, credentials, consumer, {
      experimentalClaudeOpenAiChatEnabled,
    }).map((credential) => {
      const name = findPlatform(platforms, credential.platformId)?.name ?? credential.name
      return {
        id: credential.id,
        brand: brandOfCredential(platforms, credential),
        name,
        keyName: credential.name,
      }
    })
  }, [consumer, platforms, credentials, experimentalClaudeOpenAiChatEnabled])

  const defaultProviderLabel = harnessId === 'codex'
    ? t('resources.providers.defaultLabelCodex')
    : harnessId === 'claude'
      ? t('resources.providers.defaultLabelClaude')
      : t('chat.sessionAgentsConfirm.defaultProvider')

  const providers = useMemo(
    () => mergeCollabProviders({
      harnessId,
      profileProviders: profile?.apiProviders ?? [],
      live: liveProviders,
      defaultLabel: defaultProviderLabel,
    }),
    [harnessId, profile?.apiProviders, liveProviders, defaultProviderLabel],
  )

  const selectedProviderId = apiProviderId ?? null

  const effective = useMemo(() => {
    if (!consumer) return null
    return resolveEffective(platforms, credentials, bindings, consumer, selectedProviderId, {
      experimentalClaudeOpenAiChatEnabled,
    })
  }, [consumer, platforms, credentials, bindings, selectedProviderId, experimentalClaudeOpenAiChatEnabled])

  const activeModelEnv = useMemo(() => {
    if (harnessId !== 'claude') return null
    const mapping = effective?.modelMapping
    return mapping && Object.keys(mapping).length > 0 ? mapping : null
  }, [harnessId, effective])

  const loadCodexModels = useMemo(() => {
    if (harnessId !== 'codex') return null
    return async (force = false) => {
      const projectPath = activeProject || ''
      const listModels = window.app?.codexListModels
      if (!projectPath || typeof listModels !== 'function') {
        setCodexModels((prev) => (prev.length === 0 ? prev : []))
        return
      }
      const requestId = ++codexRequestId.current
      setCodexLoading(true)
      try {
        const models = await listModels(projectPath, selectedProviderId, force)
        if (requestId !== codexRequestId.current) return
        setCodexModels(Array.isArray(models) ? models : [])
      } catch {
        if (requestId !== codexRequestId.current) return
        setCodexModels([])
      } finally {
        if (requestId === codexRequestId.current) setCodexLoading(false)
      }
    }
  }, [harnessId, activeProject, selectedProviderId])

  useEffect(() => {
    if (!loadCodexModels) {
      setCodexModels((prev) => (prev.length === 0 ? prev : []))
      return
    }
    void loadCodexModels(false)
  }, [loadCodexModels])

  // When the Codex catalog for the selected key arrives, keep the pick valid.
  useEffect(() => {
    if (harnessId !== 'codex' || codexModels.length === 0) return
    if (selectedModelId && codexModels.some((model) => model.id === selectedModelId)) return
    const next = codexModels.find((model) => model.isDefault) ?? codexModels[0]
    if (!next) return
    const efforts = next.supportedReasoningEfforts?.map((effort) => effort.value) ?? []
    const effort =
      (selectedEffort && efforts.includes(selectedEffort as typeof efforts[number])
        ? selectedEffort
        : next.defaultReasoningEffort && efforts.includes(next.defaultReasoningEffort)
          ? next.defaultReasoningEffort
          : efforts[efforts.length - 1]) ?? undefined
    onChangeRef.current({ model: next.id, ...(effort ? { effort } : {}) })
  }, [harnessId, codexModels, selectedModelId, selectedEffort])

  const profileModels = profile?.models ?? []
  const profileCatalog = useMemo(() => profileModelsAsCatalog(profileModels), [profileModels])

  // Prefer the live harness catalog (same source as main chat) when present.
  const claudeBaseCatalog = useMemo(() => {
    if (claudeCatalog.length > 0) return claudeCatalog
    return profileCatalog
  }, [claudeCatalog, profileCatalog])

  const openCodeBaseCatalog = useMemo(() => {
    if (openCodeCatalog.length > 0) return openCodeCatalog
    return profileCatalog
  }, [openCodeCatalog, profileCatalog])

  const claudeSelectorModels = useMemo(
    () => (harnessId === 'claude' ? claudeModelsForProvider(claudeBaseCatalog, activeModelEnv) : []),
    [harnessId, claudeBaseCatalog, activeModelEnv],
  )

  const openCodeUsesGroups = harnessId === 'opencode' && hasSlashModelIds(openCodeBaseCatalog)

  const openCodeModels = useMemo<SelectorModelOption[] | undefined>(() => {
    if (harnessId !== 'opencode' || openCodeUsesGroups) return undefined
    return openCodeBaseCatalog.map((model) => ({
      id: model.id,
      name: resolveSlashModelLabel(model),
      ...(model.description ? { description: model.description } : {}),
    }))
  }, [harnessId, openCodeBaseCatalog, openCodeUsesGroups])

  const openCodeModelGroups = useMemo<SelectorModelGroup[] | undefined>(() => {
    if (harnessId !== 'opencode' || !openCodeUsesGroups) return undefined
    return groupModelsBySlashPrefix(openCodeBaseCatalog).map(({ group, items }) => ({
      id: group || 'other',
      name: group || 'other',
      models: items.map(({ model, label }) => ({
        id: model.id,
        name: label,
        ...(model.description ? { description: model.description } : {}),
      })),
    }))
  }, [harnessId, openCodeBaseCatalog, openCodeUsesGroups])

  const models = useMemo<SelectorModelOption[] | undefined>(() => {
    if (harnessId === 'claude') return claudeSelectorModels
    if (harnessId === 'codex') {
      if (codexModels.length > 0) return codexModelsToSelectorOptions(codexModels)
      return profileModels.map((model) => ({
        id: model.id,
        name: formatCodexModelName(model.name, model.id),
        ...(model.description ? { description: model.description } : {}),
      }))
    }
    if (harnessId === 'opencode') return openCodeModels
    // ACP + fallback: profile names as stored.
    return profileCatalog.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      ...(model.description ? { description: model.description } : {}),
    }))
  }, [
    harnessId,
    claudeSelectorModels,
    codexModels,
    profileModels,
    openCodeModels,
    profileCatalog,
  ])

  const modelGroups = openCodeModelGroups

  const selectedClaudeModel = harnessId === 'claude'
    ? claudeBaseCatalog.find((model) => model.id === selectedModelId)
    : undefined
  const selectedCodexModel = harnessId === 'codex'
    ? codexModels.find((model) => model.id === selectedModelId)
    : undefined
  const selectedOpenCodeModel = harnessId === 'opencode'
    ? openCodeBaseCatalog.find((model) => model.id === selectedModelId)
    : undefined

  const selectedModelLabel = useMemo(() => {
    if (harnessId === 'claude') {
      return resolveClaudeDisplayName(selectedClaudeModel, activeModelEnv)
        ?? models?.find((model) => model.id === selectedModelId)?.name
        ?? selectedModelId
        ?? null
    }
    if (harnessId === 'codex') {
      if (selectedCodexModel) {
        return formatCodexModelName(selectedCodexModel.name, selectedCodexModel.id)
      }
      if (selectedModelId) return formatCodexModelName(undefined, selectedModelId)
      return null
    }
    if (harnessId === 'opencode') {
      if (selectedOpenCodeModel) return resolveSlashModelLabel(selectedOpenCodeModel)
      return models?.find((model) => model.id === selectedModelId)?.name
        ?? modelGroups?.flatMap((group) => group.models).find((model) => model.id === selectedModelId)?.name
        ?? selectedModelId
        ?? null
    }
    return models?.find((model) => model.id === selectedModelId)?.name ?? selectedModelId ?? null
  }, [
    harnessId,
    selectedClaudeModel,
    activeModelEnv,
    models,
    selectedModelId,
    selectedCodexModel,
    selectedOpenCodeModel,
    modelGroups,
  ])

  const effortOptions = useMemo<SelectorEffortOption[]>(() => {
    if (harnessId === 'claude') {
      // Third-party modelMapping freezes Claude effort UI (same as main chat).
      if (activeModelEnv) return []
      const levels = selectedClaudeModel?.supportedEffortLevels
        ?? (profile?.efforts ?? []).filter((effort): effort is EffortLevel =>
          effort === 'low' || effort === 'medium' || effort === 'high'
          || effort === 'xhigh' || effort === 'max')
      return levels.map((level) => ({
        value: level,
        label: formatClaudeStyleEffortLabel(level),
      }))
    }
    if (harnessId === 'codex') {
      const efforts = selectedCodexModel?.supportedReasoningEfforts ?? []
      if (efforts.length > 0) {
        return efforts.map((effort) => ({
          value: effort.value,
          label: formatReasoningEffortLabel(effort.value),
          ...(effort.description ? { description: effort.description } : {}),
        }))
      }
      return (profile?.efforts ?? []).map((effort) => ({
        value: effort,
        label: formatReasoningEffortLabel(effort),
      }))
    }
    if (harnessId === 'opencode') {
      const levels = selectedOpenCodeModel?.supportedEffortLevels
        ?? (profile?.efforts ?? [])
      return levels.map((level) => ({
        value: level,
        label: formatClaudeStyleEffortLabel(level),
      }))
    }
    // ACP: mode ids — prefer compact human labels like AcpModelSelector.
    return (profile?.efforts ?? []).map((effort) => ({
      value: effort,
      label: formatClaudeStyleEffortLabel(effort),
    }))
  }, [
    harnessId,
    activeModelEnv,
    selectedClaudeModel,
    profile?.efforts,
    selectedCodexModel,
    selectedOpenCodeModel,
  ])

  const selectedEffortLabel = useMemo(() => {
    const fromOptions = effortOptions.find((option) => option.value === selectedEffort)?.label
    if (fromOptions) return fromOptions
    if (!selectedEffort) return null
    if (harnessId === 'codex') return formatReasoningEffortLabel(selectedEffort)
    return formatClaudeStyleEffortLabel(selectedEffort)
  }, [effortOptions, selectedEffort, harnessId])

  const onSelectModel = (id: string) => {
    if (harnessId === 'codex') {
      const model = codexModels.find((entry) => entry.id === id)
      const efforts = model?.supportedReasoningEfforts?.map((effort) => effort.value) ?? []
      const effort =
        (selectedEffort && efforts.includes(selectedEffort as typeof efforts[number])
          ? selectedEffort
          : model?.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)
            ? model.defaultReasoningEffort
            : efforts[efforts.length - 1]) ?? undefined
      onChange({ model: id, ...(effort ? { effort } : {}) })
      return
    }
    if (harnessId === 'claude' || harnessId === 'opencode') {
      const catalog = harnessId === 'claude' ? claudeBaseCatalog : openCodeBaseCatalog
      const model = catalog.find((entry) => entry.id === id)
      const levels = model?.supportedEffortLevels ?? []
      if (levels.length > 0) {
        const effort =
          (selectedEffort && levels.includes(selectedEffort as EffortLevel)
            ? selectedEffort
            : levels.includes('medium')
              ? 'medium'
              : levels[0]) ?? undefined
        onChange({ model: id, ...(effort ? { effort } : {}) })
        return
      }
    }
    onChange({ model: id })
  }

  const onSelectProvider = (id: string | null) => {
    onChange({ apiProviderId: id })
  }

  // Match ClaudeModelSelector easter-egg trigger labels for max / xhigh.
  const triggerLabel = useMemo<ReactNode | undefined>(() => {
    if (harnessId !== 'claude' || activeModelEnv) return undefined
    const eggName = (selectedModelLabel ?? 'Model').toUpperCase()
    if (selectedEffort === 'max') return <FireText>{`${eggName} · MAX`}</FireText>
    if (selectedEffort === 'xhigh') {
      return <span className="rainbow-text font-normal">{`${eggName} · ULTRATHINK`}</span>
    }
    return undefined
  }, [harnessId, activeModelEnv, selectedModelLabel, selectedEffort])

  return {
    models,
    modelGroups,
    selectedModelId: selectedModelId ?? null,
    selectedModelLabel,
    onSelectModel,
    effortOptions,
    selectedEffort: selectedEffort ?? null,
    selectedEffortLabel,
    onSelectEffort: (value: string) => onChange({ effort: value }),
    providers: supportsProviders ? providers : [],
    selectedProviderId,
    onSelectProvider,
    onManageProviders: () => {
      setSettingsTab?.('providers')
      navigateTo?.('settings')
    },
    onRefreshModels: loadCodexModels
      ? () => { void loadCodexModels(true) }
      : undefined,
    modelsLoading: codexLoading,
    shouldCloseAfterModelSelect: harnessId === 'codex'
      ? (id: string) => {
          const model = codexModels.find((entry) => entry.id === id)
          return (model?.supportedReasoningEfforts?.length ?? 0) <= 1
        }
      : undefined,
    triggerLabel,
  }
}
