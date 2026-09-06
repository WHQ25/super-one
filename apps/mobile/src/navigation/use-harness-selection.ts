import { useState } from 'react'
import type { HarnessId, RemoteEffortOption, RemoteSystemInfo } from '@superone/shared/agent-types'
import {
  effortOptionsForModel,
  resolveSelectedEffort,
  resolveSelectedModel,
} from '../model-selection-state'

export function useHarnessSelection() {
  const [selectedProvider, setSelectedProvider] = useState<HarnessId>('claude')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState('')
  const [selectedAcpAgentId, setSelectedAcpAgentId] = useState<string | null>(null)
  const [models, setModels] = useState<NonNullable<RemoteSystemInfo['models']>>([])
  const [efforts, setEfforts] = useState<RemoteEffortOption[]>([])
  const [systemInfo, setSystemInfo] = useState<RemoteSystemInfo>({})
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
    setSelectedAcpAgentId(provider === 'acp' ? acpAgentId : null)
  }

  const selectModel = (model: string) => {
    const nextEfforts = effortOptionsForModel(selectedProvider, systemInfo, model)
    setSelectedModel(model)
    setEfforts(nextEfforts)
    setSelectedEffort(resolveSelectedEffort(nextEfforts, selectedEffort))
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
    permissionMode,
    setPermissionMode,
    permissionModes,
    applySystemInfo,
    resetForProvider,
    selectModel,
  }
}
