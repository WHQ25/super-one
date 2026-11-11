import { useMemo } from 'react'
import { filterEnabledCursorModels } from '@superone/cursor/cursor-config'
import { useChatStore } from '@/stores/chat'
import { pickLaunchRefresh, useHarnessCatalogRefresh } from '../catalog-refresh'
import { FlatLaunchModel, liveOrProfile, useProfileCatalog, type LaunchModelProps } from '../launch-model'

/** Cursor hides models the user disabled in harness config, exactly as the composer picker does. */
export function CursorLaunchModel({ profile, catalog, model, effort, optionParams, onOptionParamChange, onRefreshModels, modelsLoading, onChange }: LaunchModelProps) {
  const profileOnly = catalog === 'profile'
  const refresh = pickLaunchRefresh(profileOnly, useHarnessCatalogRefresh('cursor', !profileOnly), { onRefreshModels, modelsLoading })
  const resources = useChatStore((s) => (profileOnly ? undefined : s.harnessResources.cursor))
  const profileCatalog = useProfileCatalog(profile)
  const live = useMemo(() => filterEnabledCursorModels(resources?.models ?? [], resources), [resources])
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
