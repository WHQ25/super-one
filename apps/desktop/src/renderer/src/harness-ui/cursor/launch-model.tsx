import { useMemo } from 'react'
import { filterEnabledCursorModels } from '@superone/cursor/cursor-config'
import { useChatStore } from '@/stores/chat'
import { FlatLaunchModel, liveOrProfile, useProfileCatalog, type LaunchModelProps } from '../launch-model'

/** Cursor hides models the user disabled in harness config, exactly as the composer picker does. */
export function CursorLaunchModel({ profile, catalog, model, effort, optionParams, onOptionParamChange, onChange }: LaunchModelProps) {
  const resources = useChatStore((s) => (catalog === 'profile' ? undefined : s.harnessResources.cursor))
  const profileCatalog = useProfileCatalog(profile)
  const live = useMemo(() => filterEnabledCursorModels(resources?.models ?? [], resources), [resources])
  return (
    <FlatLaunchModel
      catalog={liveOrProfile(live, profileCatalog)}
      model={model}
      effort={effort}
      optionParams={optionParams}
      onOptionParamChange={onOptionParamChange}
      onChange={onChange}
    />
  )
}
