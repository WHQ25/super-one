import type { AcpResources, AgentEvent } from '@superone/shared/agent-types'
import { isAcpEffortConfigId, isAcpEffortConfigOption } from '@superone/shared/effort-labels'
import { overlayAcpModelList } from '@superone/shared/harness/acp-mode-catalog'
import { withoutProjectScopedWorkflows } from '@superone/shared/workflow-commands'
import { acpResourcesFor, mapAcpResources, type AcpResourceSlots } from './acp-slots'

type AcpCatalogEvent = Extract<AgentEvent, { type: 'acp_models' | 'acp_modes' | 'acp_commands' }>

export function patchAcpResourcesFromEvent(
  resources: AcpResourceSlots,
  event: AcpCatalogEvent,
  sessionAgentId: string | null | undefined,
): AcpResourceSlots | null {
  const agentId = event.agentId ?? sessionAgentId
  const acp = acpResourcesFor(resources, agentId)
  const hasContent = event.type === 'acp_models'
    ? event.models.length > 0
    : event.type === 'acp_modes'
      ? event.modes.length > 0
      : true
  if (
    !agentId
    || !acp
    || !hasContent
    || (sessionAgentId && event.agentId && event.agentId !== sessionAgentId)
  ) {
    return null
  }
  const slot = acp
  const prevConfig = slot.configByAgentId?.[agentId]
  const prevOptions = [...(prevConfig?.configOptions ?? [])]
  const now = new Date().toISOString()
  const base = {
    extraModels: prevConfig?.extraModels,
    selectedModelId: prevConfig?.selectedModelId ?? null,
    modelConfigId: prevConfig?.modelConfigId ?? null,
    extraModes: prevConfig?.extraModes,
    selectedModeId: prevConfig?.selectedModeId,
    modeConfigId: prevConfig?.modeConfigId,
    slashCommands: prevConfig?.slashCommands,
    updatedAt: now,
  }

  let next: AcpResources
  if (event.type === 'acp_models') {
    const modelId = event.configId ?? 'model'
    const enrichedModels = prevConfig?.extraModels?.length
      ? overlayAcpModelList(event.models, prevConfig.extraModels)
      : event.models
    const preservedSelectedModelId =
      prevConfig?.selectedModelId && enrichedModels.some((m) => m.id === prevConfig.selectedModelId)
        ? prevConfig.selectedModelId
        : event.selectedModelId
    const modelOpt = {
      id: modelId,
      name: 'Model',
      category: 'model' as const,
      type: 'select' as const,
      currentValue: preservedSelectedModelId,
      options: enrichedModels.map((model) => ({
        value: model.id,
        name: model.name,
        description: model.description || null,
      })),
    }
    const withoutModel = prevOptions.filter((option) => option.category !== 'model' && option.id !== 'model' && option.id !== modelId)
    next = {
      ...slot,
      modelsByAgentId: {
        ...(slot.modelsByAgentId ?? {}),
        [agentId]: {
          models: enrichedModels,
          selectedModelId: preservedSelectedModelId,
          configId: event.configId,
          updatedAt: now,
        },
      },
      configByAgentId: {
        ...(slot.configByAgentId ?? {}),
        [agentId]: {
          configOptions: event.configId ? [...withoutModel, modelOpt] : prevOptions,
          extraModels: enrichedModels,
          selectedModelId: preservedSelectedModelId,
          modelConfigId: event.configId,
          extraModes: prevConfig?.extraModes,
          selectedModeId: prevConfig?.selectedModeId,
          modeConfigId: prevConfig?.modeConfigId,
          slashCommands: prevConfig?.slashCommands,
          updatedAt: now,
        },
      },
    }
  } else if (event.type === 'acp_modes' && isAcpEffortConfigId(event.configId)) {
    const preservedSelectedModeId =
      prevConfig?.selectedModeId && event.modes.some((m) => m.id === prevConfig.selectedModeId)
        ? prevConfig.selectedModeId
        : event.selectedModeId
    const withoutEffort = prevOptions.filter(
      (option) => option.category !== 'mode' && option.id !== 'mode' && !isAcpEffortConfigOption(option),
    )
    const configOptions = event.configId
      ? [...withoutEffort, {
          id: event.configId,
          name: 'Reasoning Effort',
          category: 'thought_level' as const,
          type: 'select' as const,
          currentValue: preservedSelectedModeId,
          options: event.modes.map((mode) => ({
            value: mode.id,
            name: mode.name,
            description: mode.description || null,
          })),
        }]
      : withoutEffort
    next = {
      ...slot,
      configByAgentId: {
        ...(slot.configByAgentId ?? {}),
        [agentId]: {
          ...base,
          configOptions,
          extraModes: event.modes,
          selectedModeId: preservedSelectedModeId,
          modeConfigId: event.configId,
        },
      },
    }
  } else if (event.type === 'acp_modes' && event.configId) {
    const modeId = event.configId
    const modeOpt = {
      id: modeId,
      name: 'Session Mode',
      category: 'mode' as const,
      type: 'select' as const,
      currentValue: event.selectedModeId,
      options: event.modes.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description || null,
      })),
    }
    const withoutMode = prevOptions.filter(
      (option) => option.category !== 'mode' && option.id !== 'mode' && option.id !== modeId && !isAcpEffortConfigOption(option),
    )
    next = {
      ...slot,
      configByAgentId: {
        ...(slot.configByAgentId ?? {}),
        [agentId]: {
          ...base,
          configOptions: [...withoutMode, modeOpt],
          extraModes: undefined,
          selectedModeId: event.selectedModeId,
          modeConfigId: modeId,
        },
      },
    }
  } else if (event.type === 'acp_commands') {
    next = {
      ...slot,
      configByAgentId: {
        ...(slot.configByAgentId ?? {}),
        [agentId]: {
          ...base,
          configOptions: prevConfig?.configOptions ?? [],
          slashCommands: withoutProjectScopedWorkflows(event.commands),
        },
      },
    }
  } else {
    return null
  }
  return mapAcpResources(resources, agentId, () => next)
}
