import { useMemo } from 'react'
import { formatEffortOptionLabel, sortEffortsAscending } from '@superone/shared/effort-labels'
import { acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { useChatStore } from '@/stores/chat'
import { getCachedAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { GroupedModelEffortSelector } from '@/components/chat/model-selector/GroupedModelEffortSelector'
import { effortLabel, useProfileCatalog, type LaunchModelProps } from '../launch-model'
import { acpSelectorModels } from './model-options'

/**
 * A local launch reads the agent's live catalog, the same one the composer's
 * `AcpModelSelector` shows, so a real session mode never appears as effort. A
 * remote launch reads only the target's profile.
 */
export function AcpLaunchModel({ profile, catalog, acpAgentId, model, effort, onChange }: LaunchModelProps) {
  const resources = useChatStore((s) => (catalog === 'profile' ? null : s.harnessResources.acp))
  const agentId = acpAgentId ?? profile?.acpAgentId ?? resources?.selectedAgentId ?? null
  const live = useMemo(() => getCachedAcpCatalog(resources, agentId), [resources, agentId])
  const profileCatalog = useProfileCatalog(profile)
  const base = live?.models.length ? live.models : profileCatalog
  const view = useMemo(() => acpSelectorModels(base, agentId), [base, agentId])
  const profileEfforts = profile?.efforts
  const effortOptions = useMemo(
    () => (live
      ? acpModeCatalog(live).efforts
      : sortEffortsAscending((profileEfforts ?? []).map((value) => ({ value, label: formatEffortOptionLabel(value) })))),
    [live, profileEfforts],
  )
  const selected = base.find((entry) => entry.id === model)

  return (
    <GroupedModelEffortSelector
      models={view.models}
      modelGroups={view.modelGroups}
      selectedModelId={model ?? null}
      selectedModelLabel={selected ? view.label(selected) : model ?? null}
      onSelectModel={(id) => onChange({ model: id })}
      effortOptions={effortOptions}
      selectedEffort={effort ?? null}
      selectedEffortLabel={effortLabel(effortOptions, effort)}
      onSelectEffort={(value) => onChange({ effort: value })}
    />
  )
}
