import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption, ProviderModelEnv } from '@superone/shared/agent-types'
import { resolveClaudeDisplayName, resolveClaudeEntries } from '@superone/shared/claude-model-mapping'
import { useChatStore } from '@/stores/chat'
import { FireText } from '@/components/chat/FireText'
import {
  GroupedModelEffortSelector,
  type SelectorEffortOption,
  type SelectorModelOption,
} from '@/components/chat/model-selector/GroupedModelEffortSelector'
import {
  effortLabel,
  levelEffortOptions,
  liveOrProfile,
  profileEffortLevels,
  useLaunchProviders,
  useProfileCatalog,
  type LaunchModelProps,
} from '../launch-model'
import { effortForLevels } from '../effort'

const EMPTY_MODELS: ModelOption[] = []
const NO_EFFORT: SelectorEffortOption[] = []

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

export function ClaudeLaunchModel({ profile, catalog, apiProviderId, model, effort, onChange }: LaunchModelProps) {
  const { t } = useTranslation()
  const profileOnly = catalog === 'profile'
  const live = useChatStore((s) => (profileOnly ? EMPTY_MODELS : s.harnessResources.claude?.models ?? EMPTY_MODELS))
  const profileCatalog = useProfileCatalog(profile)
  const { effective, selector } = useLaunchProviders({
    harnessId: 'claude',
    defaultBrand: 'claude',
    defaultLabel: t('resources.providers.defaultLabelClaude'),
    profile,
    profileOnly,
    apiProviderId,
    onChange,
  })

  const modelEnv = useMemo(() => {
    const mapping = profileOnly
      ? profile?.apiProviders.find((provider) => provider.id === selector.selectedProviderId)?.modelEnv
      : effective?.modelMapping
    return mapping && Object.keys(mapping).length > 0 ? mapping : null
  }, [profileOnly, profile?.apiProviders, selector.selectedProviderId, effective])

  const base = liveOrProfile(live, profileCatalog)
  const models = useMemo(() => claudeModelsForProvider(base, modelEnv), [base, modelEnv])
  const selected = base.find((entry) => entry.id === model)
  const label = resolveClaudeDisplayName(selected, modelEnv)
    ?? models.find((entry) => entry.id === model)?.name
    ?? model
    ?? null

  // Third-party modelMapping freezes Claude effort UI (same as main chat).
  const effortOptions = useMemo(
    () => (modelEnv ? NO_EFFORT : levelEffortOptions(selected?.supportedEffortLevels ?? profileEffortLevels(profile))),
    [modelEnv, selected, profile],
  )

  return (
    <GroupedModelEffortSelector
      models={models}
      selectedModelId={model ?? null}
      selectedModelLabel={label}
      onSelectModel={(id) => {
        const next = effortForLevels(base.find((entry) => entry.id === id)?.supportedEffortLevels, effort)
        onChange({ model: id, ...(next ? { effort: next } : {}) })
      }}
      effortOptions={effortOptions}
      selectedEffort={effort ?? null}
      selectedEffortLabel={effortLabel(effortOptions, effort)}
      onSelectEffort={(value) => onChange({ effort: value })}
      {...selector}
      // Match ClaudeModelSelector's easter-egg trigger label for max.
      triggerLabel={!modelEnv && effort === 'max'
        ? <FireText>{`${(label ?? 'Model').toUpperCase()} · MAX`}</FireText>
        : undefined}
    />
  )
}
