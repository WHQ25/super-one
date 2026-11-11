import type { ModelOption } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { pickLaunchRefresh, useHarnessCatalogRefresh } from '../catalog-refresh'
import { FlatLaunchModel, liveOrProfile, useProfileCatalog, type LaunchModelProps } from '../launch-model'

const EMPTY_MODELS: ModelOption[] = []

export function DshLaunchModel({ profile, catalog, model, effort, optionParams, onOptionParamChange, onRefreshModels, modelsLoading, onChange }: LaunchModelProps) {
  const profileOnly = catalog === 'profile'
  const refresh = pickLaunchRefresh(profileOnly, useHarnessCatalogRefresh('dsh', !profileOnly), { onRefreshModels, modelsLoading })
  const live = useChatStore((s) => (profileOnly ? EMPTY_MODELS : s.harnessResources.dsh?.models ?? EMPTY_MODELS))
  const profileCatalog = useProfileCatalog(profile)
  return (
    <FlatLaunchModel
      catalog={liveOrProfile(live, profileCatalog)}
      model={model}
      effort={effort}
      optionParams={optionParams}
      onOptionParamChange={onOptionParamChange}
      onRefreshModels={refresh.onRefreshModels}
      modelsLoading={refresh.modelsLoading}
      onChange={onChange}
    />
  )
}
