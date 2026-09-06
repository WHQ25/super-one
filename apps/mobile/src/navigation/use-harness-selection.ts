import { useMemo, useState } from 'react'
import type {
  HarnessId,
  RemoteAgentOption,
  RemoteEffortOption,
  RemoteModeOption,
  RemoteProviderOption,
  RemoteSystemInfo,
} from '@superone/shared/agent-types'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import {
  effortOptionsForModel,
  resolveSelectedEffort,
  resolveSelectedModel,
} from '../model-selection-state'
import { optionParamsForModel } from '../model-picker-state'

export function useHarnessSelection() {
  const [selectedProvider, setSelectedProvider] = useState<HarnessId>('claude')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState('')
  const [selectedAcpAgentId, setSelectedAcpAgentId] = useState<string | null>(null)
  const [models, setModels] = useState<NonNullable<RemoteSystemInfo['models']>>([])
  const [efforts, setEfforts] = useState<RemoteEffortOption[]>([])
  const [systemInfo, setSystemInfo] = useState<RemoteSystemInfo>({})
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  // Codex Fast and Cursor catalog params are per model, so a model switch clears them.
  const [serviceTier, setServiceTier] = useState<string | null>(null)
  const [modelParams, setModelParams] = useState<Record<string, string>>({})
  const [permissionMode, setPermissionMode] = useState('default')
  const [permissionModes, setPermissionModes] = useState<string[]>([
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
  ])

  const applySystemInfo = (
    provider: HarnessId,
    info: RemoteSystemInfo,
    current?: { model?: string; effort?: string; permissionMode?: string },
  ) => {
    const model = resolveSelectedModel(info, current?.model)
    const nextEfforts = effortOptionsForModel(provider, info, model)
    const effort = resolveSelectedEffort(nextEfforts, current?.effort ?? info.defaults?.effort)
    const modes = info.permissionModes?.length
      ? info.permissionModes
      : info.permissionPresets ?? []
    const nextPermissionMode = current?.permissionMode && modes.includes(current.permissionMode)
      ? current.permissionMode
      : info.defaults?.permissionMode && modes.includes(info.defaults.permissionMode)
        ? info.defaults.permissionMode
        : modes[0] ?? 'default'

    setSystemInfo(info)
    setModels(info.models ?? [])
    setSelectedAgentId(info.selectedAgentId ?? null)
    setSelectedModeId(info.selectedModeId ?? null)
    setSelectedProviderId(info.selectedProviderId ?? null)
    setServiceTier(null)
    setModelParams({})
    setSelectedModel(model)
    setEfforts(nextEfforts)
    setSelectedEffort(effort)
    // A user-picked ACP agent outranks whatever the host happens to report:
    // the switcher chose `Grok Build`, not "whichever agent is loaded".
    setSelectedAcpAgentId((current) => provider === 'acp' ? current ?? info.acpAgentId ?? null : null)
    setPermissionModes(modes.length ? modes : ['default'])
    setPermissionMode(nextPermissionMode)
  }

  /** `acpAgentId` names which ACP agent the switcher row stood for. */
  const resetForProvider = (provider: HarnessId, acpAgentId: string | null = null) => {
    setSelectedProvider(provider)
    setSystemInfo({})
    setModels([])
    setPermissionModes([])
    setPermissionMode('default')
    setSelectedModel('')
    setSelectedEffort('')
    setEfforts([])
    setSelectedAgentId(null)
    setSelectedModeId(null)
    setSelectedProviderId(null)
    setServiceTier(null)
    setModelParams({})
    setSelectedAcpAgentId(provider === 'acp' ? acpAgentId : null)
  }

  const selectModel = (model: string) => {
    const nextEfforts = effortOptionsForModel(selectedProvider, systemInfo, model)
    setSelectedModel(model)
    setEfforts(nextEfforts)
    setSelectedEffort(resolveSelectedEffort(nextEfforts, selectedEffort))
    // The option catalog belongs to the model that declared it.
    setServiceTier(null)
    setModelParams({})
  }

  const currentModel = models.find((model) => model.id === selectedModel)
  const optionParams = useMemo(
    () => optionParamsForModel(selectedProvider, currentModel, { serviceTier, params: modelParams }),
    [selectedProvider, currentModel, serviceTier, modelParams],
  )

  /** Codex's Fast row is a service tier; every other param is a catalog value. */
  const setOptionParam = (id: string, value: string) => {
    if (selectedProvider === 'codex' && id === 'fast') {
      setServiceTier(value === 'true' ? findCodexFastServiceTier(currentModel)?.id ?? null : null)
      return
    }
    setModelParams((current) => ({ ...current, [id]: value }))
  }

  return {
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    selectedEffort,
    setSelectedEffort,
    selectedAcpAgentId,
    activeProvider: systemInfo.activeProvider ?? null,
    activeProviderName: systemInfo.activeProvider?.name,
    models,
    efforts,
    agents: (systemInfo.agents ?? []) as RemoteAgentOption[],
    selectedAgentId,
    selectAgent: setSelectedAgentId,
    modes: (systemInfo.modes ?? []) as RemoteModeOption[],
    modeLabel: systemInfo.modeLabel,
    modesLocked: systemInfo.modesLocked,
    selectedModeId,
    selectMode: setSelectedModeId,
    providers: (systemInfo.providers ?? []) as RemoteProviderOption[],
    selectedProviderId,
    selectProvider: setSelectedProviderId,
    optionParams,
    setOptionParam,
    serviceTier,
    modelParams,
    permissionMode,
    setPermissionMode,
    permissionModes,
    applySystemInfo,
    resetForProvider,
    selectModel,
  }
}
