import type { ModelOption } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { FlatLaunchModel, liveOrProfile, useProfileCatalog, type LaunchModelProps } from '../launch-model'

const EMPTY_MODELS: ModelOption[] = []

export function DshLaunchModel({ profile, catalog, model, effort, optionParams, onOptionParamChange, onChange }: LaunchModelProps) {
  const live = useChatStore((s) => (catalog === 'profile' ? EMPTY_MODELS : s.harnessResources.dsh?.models ?? EMPTY_MODELS))
  const profileCatalog = useProfileCatalog(profile)
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
