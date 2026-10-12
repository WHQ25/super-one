import type { ModelOption } from '@superone/shared/agent-types'
import type { SelectorModelGroup, SelectorModelOption } from '@/components/chat/model-selector/GroupedModelEffortSelector'
import { resolveSlashModelLabel } from '@/components/chat/ModelSelectorLists'
import { toSelectorGroups, toSelectorModels } from '../selector-models'

/** Model list for an ACP agent, shared by the composer and launch rows. */
export function acpSelectorModels(models: ModelOption[], agentId: string | null): {
  models?: SelectorModelOption[]
  modelGroups?: SelectorModelGroup[]
  label: (model: ModelOption) => string
} {
  // OpenCode catalogs use `provider/model` ids; group by provider.
  if (agentId === 'opencode') {
    return { modelGroups: toSelectorGroups(models), label: resolveSlashModelLabel }
  }
  return { models: toSelectorModels(models), label: (model) => model.name || model.id }
}
