import type { ModelOption } from '@superone/shared/agent-types'
import { groupModelsBySlashPrefix } from '@/components/chat/ModelSelectorLists'
import type { SelectorModelGroup, SelectorModelOption } from '@/components/chat/model-selector/GroupedModelEffortSelector'

export function toSelectorModels(
  models: ModelOption[],
  label: (model: ModelOption) => string = (model) => model.name || model.id,
): SelectorModelOption[] {
  return models.map((model) => ({
    id: model.id,
    name: label(model),
    ...(model.description ? { description: model.description } : {}),
  }))
}

/** `provider/model` catalogs grouped by provider, as the composer lists them. */
export function toSelectorGroups(models: ModelOption[]): SelectorModelGroup[] {
  return groupModelsBySlashPrefix(models).map(({ group, items }) => ({
    id: group || 'other',
    name: items[0]?.model.providerName || group || 'other',
    models: items.map(({ model, label }) => ({
      id: model.id,
      name: label,
      ...(model.description ? { description: model.description } : {}),
    })),
  }))
}
