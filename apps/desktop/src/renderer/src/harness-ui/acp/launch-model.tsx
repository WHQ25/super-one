import { useMemo } from 'react'
import { acpAgentIdForHarness, isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import type { AcpHarnessId } from '@/stores/chat-store/harness/acp-slots'
import { formatEffortOptionLabel, sortEffortsAscending } from '@superone/shared/effort-labels'
import { acpEffortOptionsForModel, acpModeCatalog, clampAcpEffortForModel } from '@superone/shared/harness/acp-mode-catalog'
import { useChatStore } from '@/stores/chat'
import { getCachedAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { GroupedModelEffortSelector } from '@/components/chat/model-selector/GroupedModelEffortSelector'
import { pickLaunchRefresh, useHarnessCatalogRefresh } from '../catalog-refresh'
import { effortLabel, useProfileCatalog, type LaunchModelProps } from '../launch-model'
import { acpSelectorModels, projectAntigravityModels } from './model-options'

export function AcpLaunchModel({
  profile, catalog, acpAgentId, model, effort, optionParams, onOptionParamChange, onRefreshModels, modelsLoading, onChange, harnessId,
}: LaunchModelProps & { harnessId: AcpHarnessId }) {
  const profileOnly = catalog === 'profile'
  const refresh = pickLaunchRefresh(profileOnly, useHarnessCatalogRefresh(harnessId, !profileOnly), { onRefreshModels, modelsLoading })
  const resources = useChatStore((s) => (profileOnly ? null : s.harnessResources[harnessId]))
  const agentId = acpAgentId ?? profile?.acpAgentId ?? acpAgentIdForHarness(harnessId)
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
  const rawModeEfforts = useMemo(
    () => (live
      ? acpModeCatalog(live).efforts
      : sortEffortsAscending((profileEfforts ?? []).map((value) => ({ value, label: formatEffortOptionLabel(value) })))),
    [live, profileEfforts],
  )
  const modeEffortOptions = useMemo(
    () => acpEffortOptionsForModel(base, model ?? null, rawModeEfforts),
    [base, model, rawModeEfforts],
  )
  const useModelIdEfforts = Boolean(antigravityView && antigravityView.effortOptions.length > 0)
  const effortOptions = useModelIdEfforts ? antigravityView!.effortOptions : modeEffortOptions
  const selectedEffort = useModelIdEfforts
    ? antigravityView!.selectedEffort
    : clampAcpEffortForModel(modeEffortOptions, effort)
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
      onSelectModel={(id) => {
        if (useModelIdEfforts && antigravityView) {
          onChange({ model: antigravityView.resolveModelId(id, effort) })
          return
        }
        const resolvedId = antigravityView ? antigravityView.resolveModelId(id, effort) : id
        const nextEfforts = acpEffortOptionsForModel(base, resolvedId, rawModeEfforts)
        const shouldAdjustEffort = Boolean(effort && !nextEfforts.some((opt) => opt.value === effort))
        onChange({
          model: resolvedId,
          ...(shouldAdjustEffort ? { effort: clampAcpEffortForModel(nextEfforts, effort) ?? undefined } : {}),
        })
      }}
      effortOptions={effortOptions}
      selectedEffort={selectedEffort}
      selectedEffortLabel={
        useModelIdEfforts
          ? antigravityView!.selectedEffortLabel
          : (selectedEffort ? effortLabel(effortOptions, selectedEffort) : null)
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
      onRefreshModels={refresh.onRefreshModels}
      modelsLoading={refresh.modelsLoading}
    />
  )
}
