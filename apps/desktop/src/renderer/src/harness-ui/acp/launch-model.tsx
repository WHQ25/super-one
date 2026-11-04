import { useMemo } from 'react'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import { formatEffortOptionLabel, sortEffortsAscending } from '@superone/shared/effort-labels'
import { acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { useChatStore } from '@/stores/chat'
import { getCachedAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { GroupedModelEffortSelector } from '@/components/chat/model-selector/GroupedModelEffortSelector'
import { effortLabel, useProfileCatalog, type LaunchModelProps } from '../launch-model'
import { acpSelectorModels, projectAntigravityModels } from './model-options'

export function AcpLaunchModel({
  profile, catalog, acpAgentId, model, effort, optionParams, onOptionParamChange, onChange,
}: LaunchModelProps) {
  const resources = useChatStore((s) => (catalog === 'profile' ? null : s.harnessResources.acp))
  const agentId = acpAgentId ?? profile?.acpAgentId ?? resources?.selectedAgentId ?? null
  const live = useMemo(() => getCachedAcpCatalog(resources, agentId), [resources, agentId])
  const profileCatalog = useProfileCatalog(profile)
  const base = live?.models.length ? live.models : profileCatalog
  const isAntigravity = isAntigravityAcpAgent(agentId)
  const antigravityView = useMemo(
    () => (isAntigravity ? projectAntigravityModels(base, model ?? null, effort) : null),
    [isAntigravity, base, model, effort],
  )
  const view = useMemo(() => acpSelectorModels(base, agentId), [base, agentId])
  const profileEfforts = profile?.efforts
  const modeEffortOptions = useMemo(
    () => (live
      ? acpModeCatalog(live).efforts
      : sortEffortsAscending((profileEfforts ?? []).map((value) => ({ value, label: formatEffortOptionLabel(value) })))),
    [live, profileEfforts],
  )
  const useModelIdEfforts = Boolean(antigravityView && antigravityView.effortOptions.length > 0)
  const effortOptions = useModelIdEfforts ? antigravityView!.effortOptions : modeEffortOptions
  const selectedEffort = useModelIdEfforts ? antigravityView!.selectedEffort : (effort ?? null)
  const selected = base.find((entry) => entry.id === model)

  return (
    <GroupedModelEffortSelector
      models={antigravityView ? antigravityView.models : view.models}
      modelGroups={view.modelGroups}
      selectedModelId={antigravityView ? antigravityView.selectedBaseModelId : (model ?? null)}
      selectedModelLabel={
        antigravityView
          ? antigravityView.selectedModelLabel
          : selected
            ? view.label(selected)
            : (model ?? null)
      }
      onSelectModel={(id) =>
        onChange({ model: antigravityView ? antigravityView.resolveModelId(id, effort) : id })
      }
      effortOptions={effortOptions}
      selectedEffort={selectedEffort}
      selectedEffortLabel={
        useModelIdEfforts
          ? antigravityView!.selectedEffortLabel
          : effortLabel(effortOptions, effort)
      }
      onSelectEffort={(value) => {
        if (useModelIdEfforts && antigravityView) {
          const nextModelId = antigravityView.resolveEffortModelId(value)
          if (nextModelId) onChange({ model: nextModelId })
          return
        }
        onChange({ effort: value })
      }}
      optionParams={optionParams}
      onOptionParamChange={onOptionParamChange}
    />
  )
}
