import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useActiveSession, useChatStore, useScopedSessionActions } from '@/stores/chat'
import type { AcpAgentDescriptor } from '@superone/shared/agent-types'
import { acpAgentDisplayName, acpAgentIdForHarness, isAcpProtocolHarness, isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import { formatEffortOptionLabel } from '@superone/shared/effort-labels'
import { acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { acpSelectorModels, projectAntigravityModels } from '@/harness-ui/acp/model-options'
import { GroupedModelEffortSelector, type SelectorEffortOption } from './GroupedModelEffortSelector'
import { acpContextWindowParam } from './AcpContextWindowSelect'

const EMPTY_ACP_AGENTS: AcpAgentDescriptor[] = []

export function AcpModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()

  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpModels = useActiveSession((s) => s.acpModels)
  const acpModelsStatus = useActiveSession((s) => s.acpModelsStatus)
  const acpModelsError = useActiveSession((s) => s.acpModelsError)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  // Grok effort is configId null (legacy x.ai) or `reasoning_effort` (thought_level).
  // Real session modes (OpenCode `mode`) stay in AcpModeSelector.
  const acpModes = useActiveSession((s) => s.acpModes)
  const acpModeConfigId = useActiveSession((s) => s.acpModeConfigId)
  const selectedAcpModeId = useActiveSession((s) => s.selectedAcpModeId)
  const selectedAcpContextWindow = useActiveSession((s) => s.selectedAcpContextWindow ?? null)
  const grokAgents = useChatStore((s) => s.harnessResources['acp-grok']?.agents ?? EMPTY_ACP_AGENTS)
  const antiAgents = useChatStore((s) => s.harnessResources['acp-antigravity']?.agents ?? EMPTY_ACP_AGENTS)
  const provider = sessionProvider || preferredProvider
  const agents = isAcpProtocolHarness(provider) && acpAgentIdForHarness(provider) === 'antigravity'
    ? antiAgents
    : isAcpProtocolHarness(provider)
      ? grokAgents
      : [...grokAgents, ...antiAgents]
  const { setSelectedModel, setSelectedAcpMode, setSelectedAcpContextWindow } = useScopedSessionActions()

  const agent = agents.find((a) => a.id === acpAgentId)
  // Prefer catalog name; if agents aren't loaded yet (mini-window cold start), derive from id.
  const agentLabel = agent?.name ?? (acpAgentId ? acpAgentDisplayName(acpAgentId) : null)
  const view = useMemo(() => acpSelectorModels(acpModels, acpAgentId), [acpModels, acpAgentId])
  const currentModel = acpModels.find((m) => m.id === selectedModel)
  const contextParam = useMemo(
    () => acpContextWindowParam(
      currentModel?.contextWindows,
      selectedAcpContextWindow,
      currentModel?.contextWindow ?? null,
      t('chat.acpPermissionModes.contextWindowLabel'),
    ),
    [currentModel?.contextWindows, currentModel?.contextWindow, selectedAcpContextWindow, t],
  )
  // Prefer catalog display name; fall back to raw selectedModel id (live sync may
  // have the id before acp_models replay fills names).
  const modelLabel = currentModel ? view.label(currentModel) : (selectedModel || null)
  const currentLabel = modelLabel ?? agentLabel ?? t('chat.suggestions.acpLabel')

  const isAntigravity = isAntigravityAcpAgent(acpAgentId)
  const antigravityView = useMemo(
    () => (isAntigravity ? projectAntigravityModels(acpModels, selectedModel) : null),
    [isAntigravity, acpModels, selectedModel],
  )
  const modeEffortOptions = useMemo<SelectorEffortOption[]>(
    () => acpModeCatalog({ modes: acpModes, modeConfigId: acpModeConfigId, selectedModeId: selectedAcpModeId }).efforts,
    [acpModes, acpModeConfigId, selectedAcpModeId],
  )
  const useModelIdEfforts = Boolean(antigravityView && antigravityView.effortOptions.length > 0)
  const effortOptions = useModelIdEfforts ? antigravityView!.effortOptions : modeEffortOptions
  const effortIsAcpModeCatalog = !useModelIdEfforts && modeEffortOptions.length > 0
  const selectedEffort = useModelIdEfforts
    ? antigravityView!.selectedEffort
    : effortIsAcpModeCatalog
      ? (selectedAcpModeId ?? acpModes[0]?.id ?? null)
      : null
  const selectedEffortLabel = useModelIdEfforts
    ? antigravityView!.selectedEffortLabel
    : effortIsAcpModeCatalog
      ? formatEffortOptionLabel(
        acpModes.find((m) => m.id === selectedEffort)?.name
          ?? selectedEffort
          ?? '',
      ) || null
      : null

  if (acpModelsStatus === 'loading' || (acpModelsStatus === 'idle' && agent?.installed && !selectedModel)) {
    return (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span className="max-w-35 truncate">{modelLabel ?? agentLabel ?? t('chat.suggestions.selectAgent')}</span>
        </span>
      </div>
    )
  }

  if (acpModels.length === 0) {
    if (selectedModel) {
      return (
        <div className="flex items-center gap-1">
          <span
            className="max-w-45 truncate rounded-lg px-2 py-1 text-xs text-muted-foreground"
            title={acpModelsError ?? selectedModel}
          >
            {selectedModel}
          </span>
        </div>
      )
    }
    const hint = acpModelsError
      ?? (!agent?.installed ? t('chat.suggestions.agentNotInstalled') : t('chat.suggestions.acpLabel'))
    return (
      <div className="flex items-center gap-1">
        <span
          className="max-w-45 truncate rounded-lg px-2 py-1 text-xs text-muted-foreground"
          title={acpModelsError ?? agent?.commandPreview ?? hint}
        >
          {agentLabel ?? t('chat.suggestions.acpLabel')}
        </span>
      </div>
    )
  }

  return (
    <GroupedModelEffortSelector
      models={antigravityView ? antigravityView.models : view.models}
      modelGroups={view.modelGroups}
      selectedModelId={antigravityView ? antigravityView.selectedBaseModelId : selectedModel}
      selectedModelLabel={antigravityView ? (antigravityView.selectedModelLabel ?? currentLabel) : currentLabel}
      onSelectModel={(id) => setSelectedModel(antigravityView ? antigravityView.resolveModelId(id) : id)}
      effortOptions={effortOptions}
      selectedEffort={selectedEffort}
      selectedEffortLabel={selectedEffortLabel}
      onSelectEffort={(nextEffort) => {
        if (useModelIdEfforts && antigravityView) {
          const nextModelId = antigravityView.resolveEffortModelId(nextEffort)
          if (nextModelId) setSelectedModel(nextModelId)
          return
        }
        setSelectedAcpMode(nextEffort)
      }}
      optionParams={contextParam ? [contextParam] : undefined}
      onOptionParamChange={contextParam ? (id, value) => {
        if (id !== 'context' || value === contextParam.selected) return
        const next = Number(value)
        if (!Number.isFinite(next) || next <= 0) return
        void setSelectedAcpContextWindow(next)
      } : undefined}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
