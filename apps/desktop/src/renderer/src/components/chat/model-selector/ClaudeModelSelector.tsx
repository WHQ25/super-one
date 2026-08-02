import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import type { EffortLevel } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore, selectClaudeModels } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { consumerForHarness, resolveEffective } from '@/lib/provider-resolve'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { FireText } from '../FireText'
import { resolveClaudeEntries, resolveClaudeDisplayName } from '../ModelSelectorLists'
import { GroupedModelEffortSelector, type SelectorEffortOption, type SelectorModelOption } from './GroupedModelEffortSelector'
import { useSelectorProviders } from './useSelectorProviders'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

interface Props {
  onCloseAutoFocus?: (e: Event) => void
}

export function ClaudeModelSelector({ onCloseAutoFocus }: Props) {
  const { t } = useTranslation()

  const selectedModel = useActiveSession((s) => s.selectedModel)
  const selectedEffort = useActiveSession((s) => s.selectedEffort)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const availableModels = useChatStore(selectClaudeModels)
  const activeProject = useChatStore((s) => s.activeProject)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const setSelectedEffort = useChatStore((s) => s.setSelectedEffort)
  const refreshClaudeResources = useChatStore((s) => s.refreshClaudeResources)
  const claudeResourcesLoading = useChatStore((s) => s.claudeResourcesLoading)
  const claudeModelsLoading = useActiveSession((s) => s.claudeModelsLoading)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const isRemoteProject = !!activeProject && !!parseRemoteProjectKey(activeProject)
  const modelsLoading = isRemoteProject ? claudeModelsLoading || claudeResourcesLoading : claudeResourcesLoading

  // Remote: load once per project / apiProvider — do NOT depend on loading flags
  // or the effect re-fires when claudeResourcesLoading toggles (infinite IPC storm).
  useEffect(() => {
    if (!isRemoteProject || !activeProject) return
    void refreshClaudeResources(false)
  }, [isRemoteProject, activeProject, sessionApiProviderId, refreshClaudeResources])

  // Local: fill empty catalog via initializeHarness / refresh.
  useEffect(() => {
    if (isRemoteProject) return
    if (availableModels.length > 0 || claudeResourcesLoading) return
    void initializeHarness('claude').then(() => {
      const models = useChatStore.getState().harnessResources.claude?.models ?? []
      if (models.length === 0) void refreshClaudeResources(true)
    })
  }, [
    isRemoteProject,
    availableModels.length,
    claudeResourcesLoading,
    initializeHarness,
    refreshClaudeResources,
  ])

  const activeProvider = sessionProvider ?? preferredProvider

  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData, providerScope])
  const effective = useMemo(
    () => resolveEffective(platforms, credentials, bindings, consumerForHarness(activeProvider), sessionApiProviderId),
    [platforms, credentials, bindings, activeProvider, sessionApiProviderId],
  )
  const activeModelEnv = useMemo(() => {
    const mapping = effective?.modelMapping
    return mapping && Object.keys(mapping).length > 0 ? mapping : null
  }, [effective])

  const fastModeState = useActiveSession((s) => s.session?.fastModeState)
  const providerProps = useSelectorProviders(activeProvider)

  // If selectedModel is empty but the catalog loaded (common on remote drafts),
  // treat the default/first model as display selection until the user picks one.
  const effectiveSelectedModelId =
    selectedModel ||
    availableModels.find((m) => m.isDefault)?.id ||
    availableModels[0]?.id ||
    ''

  useEffect(() => {
    if (selectedModel || !effectiveSelectedModelId) return
    if ((sessionProvider ?? preferredProvider) !== 'claude') return
    setSelectedModel(effectiveSelectedModelId)
  }, [
    selectedModel,
    effectiveSelectedModelId,
    sessionProvider,
    preferredProvider,
    setSelectedModel,
  ])

  const currentModel = availableModels.find((m) => m.id === (selectedModel || effectiveSelectedModelId))
  // Never surface a foreign harness model id (stale ACP/OpenCode race) as the label.
  const currentModelName = resolveClaudeDisplayName(currentModel, activeModelEnv)

  const models = useMemo<SelectorModelOption[]>(
    () => resolveClaudeEntries(availableModels, activeModelEnv).map(({ model, displayName, description }) => ({
      id: model.id,
      name: displayName,
      description,
    })),
    [availableModels, activeModelEnv],
  )

  const effortOptions = useMemo<SelectorEffortOption[]>(() => {
    if (activeModelEnv) return []
    return (currentModel?.supportedEffortLevels ?? []).map((level) => ({ value: level, label: EFFORT_LABELS[level] }))
  }, [activeModelEnv, currentModel])

  const eggName = (currentModelName ?? 'Model').toUpperCase()
  const triggerLabel = selectedEffort === 'max'
    ? <FireText>{`${eggName} · MAX`}</FireText>
    : selectedEffort === 'xhigh'
      ? <span className="rainbow-text font-normal">{`${eggName} · ULTRATHINK`}</span>
      : undefined

  return (
    <div className="flex items-center gap-1">
      {fastModeState && fastModeState !== 'off' && (
        <span title={t('tooltips.fastMode', { state: fastModeState })}>
          <Zap className={`size-3 ${fastModeState === 'on' ? 'text-yellow-500' : 'text-muted-foreground'}`} />
        </span>
      )}
      <GroupedModelEffortSelector
        models={models}
        selectedModelId={selectedModel || effectiveSelectedModelId}
        selectedModelLabel={currentModelName}
        onSelectModel={setSelectedModel}
        effortOptions={effortOptions}
        selectedEffort={selectedEffort ?? null}
        onSelectEffort={(value) => setSelectedEffort(value as EffortLevel)}
        onRefreshModels={() => void refreshClaudeResources(true)}
        modelsLoading={modelsLoading}
        triggerLabel={triggerLabel}
        onCloseAutoFocus={onCloseAutoFocus}
        {...providerProps}
      />
    </div>
  )
}
