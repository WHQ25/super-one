import { useMemo } from 'react'
import type { ModelOption } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { resolveSlashModelLabel } from '@/components/chat/ModelSelectorLists'
import { GroupedModelEffortSelector } from '@/components/chat/model-selector/GroupedModelEffortSelector'
import {
  effortForLevels,
  effortLabel,
  levelEffortOptions,
  liveOrProfile,
  useProfileCatalog,
  type LaunchModelProps,
} from '../launch-model'
import { toSelectorGroups, toSelectorModels } from '../selector-models'

const EMPTY_MODELS: ModelOption[] = []

export function OpenCodeLaunchModel({ profile, catalog, model, effort, onChange }: LaunchModelProps) {
  const live = useChatStore((s) => (catalog === 'profile' ? EMPTY_MODELS : s.harnessResources.opencode?.models ?? EMPTY_MODELS))
  const profileCatalog = useProfileCatalog(profile)
  const base = liveOrProfile(live, profileCatalog)
  // `provider/model` ids group by provider, as the composer does.
  const grouped = base.some((entry) => entry.id.includes('/'))
  const models = useMemo(() => (grouped ? undefined : toSelectorModels(base, resolveSlashModelLabel)), [grouped, base])
  const modelGroups = useMemo(() => (grouped ? toSelectorGroups(base) : undefined), [grouped, base])
  const selected = base.find((entry) => entry.id === model)
  const effortOptions = useMemo(
    () => levelEffortOptions(selected?.supportedEffortLevels ?? profile?.efforts ?? []),
    [selected, profile?.efforts],
  )

  return (
    <GroupedModelEffortSelector
      models={models}
      modelGroups={modelGroups}
      selectedModelId={model ?? null}
      selectedModelLabel={selected ? resolveSlashModelLabel(selected) : model ?? null}
      onSelectModel={(id) => {
        const next = effortForLevels(base.find((entry) => entry.id === id)?.supportedEffortLevels, effort)
        onChange({ model: id, ...(next ? { effort: next } : {}) })
      }}
      effortOptions={effortOptions}
      selectedEffort={effort ?? null}
      selectedEffortLabel={effortLabel(effortOptions, effort)}
      onSelectEffort={(value) => onChange({ effort: value })}
    />
  )
}
