import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Workflow, Zap } from 'lucide-react'
import type { EffortLevel } from '@superone/shared/agent-types'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { useActiveSession, useChatStore, useScopedSessionActions, selectClaudeModels } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { consumerForHarness, resolveEffective } from '@/lib/provider-resolve'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { FireText } from '../FireText'
import { resolveClaudeDisplayName, resolveClaudeEntries } from '@superone/shared/claude-model-mapping'
import { GroupedModelEffortSelector, type SelectorCatalogParam, type SelectorEffortOption, type SelectorModelOption } from './GroupedModelEffortSelector'
import { useSelectorProviders } from './useSelectorProviders'

interface Props {
  onCloseAutoFocus?: (e: Event) => void
}

export function ClaudeModelSelector({ onCloseAutoFocus }: Props) {
  const { t } = useTranslation()

  const selectedModel = useActiveSession((s) => s.selectedModel)
  const selectedEffort = useActiveSession((s) => s.selectedEffort)
  const ultracode = useActiveSession((s) => s.ultracode)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const availableModels = useChatStore(selectClaudeModels)
  const activeProject = useChatStore((s) => s.activeProject)
  const { setSelectedModel, setSelectedEffort, setUltracode } = useScopedSessionActions()
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

  // Local: fill empty catalog via initializeHarness / refresh. Bootstrap runs at
  // most once per mount — never depend on loading flags, and never re-arm on
  // failure. When the harness binary is missing (upgrade window before
  // ~/.superone/harness is populated) connectClaude rejects forever, and a
  // self-re-arming effect turns that into an IPC storm that kills React with
  // error #185. Recovery is the user-driven refresh in the dropdown.
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (isRemoteProject) return
    if (bootstrappedRef.current) return
    if (availableModels.length > 0 || useChatStore.getState().claudeResourcesLoading) return
    bootstrappedRef.current = true
    void initializeHarness('claude').then(() => {
      const models = useChatStore.getState().harnessResources.claude?.models ?? []
      if (models.length === 0) void refreshClaudeResources(true)
    })
  }, [isRemoteProject, availableModels.length, initializeHarness, refreshClaudeResources])

  const activeProvider = sessionProvider ?? preferredProvider

  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)
  const experimentalClaudeOpenAiChatEnabled = useAppStore((s) => s.experimentalClaudeOpenAiChatEnabled)
  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData, providerScope])
  const effective = useMemo(
    () => resolveEffective(platforms, credentials, bindings, consumerForHarness(activeProvider), sessionApiProviderId, {
      experimentalClaudeOpenAiChatEnabled,
    }),
    [platforms, credentials, bindings, activeProvider, sessionApiProviderId, experimentalClaudeOpenAiChatEnabled],
  )
  const activeModelEnv = useMemo(() => {
    const mapping = effective?.modelMapping
    return mapping && Object.keys(mapping).length > 0 ? mapping : null
  }, [effective])

  const fastModeState = useActiveSession((s) => s.session?.fastModeState)
  const providerProps = useSelectorProviders(activeProvider)

  const entries = useMemo(
    () => resolveClaudeEntries(availableModels, activeModelEnv),
    [availableModels, activeModelEnv],
  )

  // If selectedModel is empty but the catalog loaded (common on remote drafts),
  // treat the default/first model as display selection until the user picks one.
  // Read it off the resolved entries, not the raw catalog: a live mapping folds
  // the catalog's `[1m]` rows onto the plain alias, and the raw catalog would
  // hand back a suffixed id the user was never shown (see resolveClaudeEntries).
  const effectiveSelectedModelId =
    selectedModel ||
    entries.find(({ model }) => model.isDefault)?.model.id ||
    entries[0]?.model.id ||
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
    () => entries.map(({ model, displayName, description }) => ({
      id: model.id,
      name: displayName,
      description,
    })),
    [entries],
  )

  const effortOptions = useMemo<SelectorEffortOption[]>(() => {
    if (activeModelEnv) return []
    return (currentModel?.supportedEffortLevels ?? []).map((level) => ({ value: level, label: formatEffortLabel(level) }))
  }, [activeModelEnv, currentModel])

  // Claude Code offers Ultracode where dynamic workflows run on a model with xhigh
  // effort. Remote nodes do not carry the toggle yet.
  const ultracodeAvailable = !isRemoteProject && !activeModelEnv && !!currentModel?.supportedEffortLevels?.includes('xhigh')
  useEffect(() => {
    // Switching to a model or provider without it turns it off, as Claude Code
    // refuses it there. Wait for the catalog: no model yet is not "unsupported".
    if (ultracode && currentModel && !ultracodeAvailable) setUltracode(false)
  }, [ultracode, currentModel, ultracodeAvailable, setUltracode])
  const optionParams = useMemo<SelectorCatalogParam[]>(() => ultracodeAvailable
    ? [{
        id: 'ultracode',
        label: 'Ultracode',
        kind: 'toggle',
        values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }],
        selected: ultracode ? 'true' : 'false',
        description: t('tooltips.ultracodeHint'),
      }]
    : [], [ultracodeAvailable, ultracode, t])

  const eggName = (currentModelName ?? 'Model').toUpperCase()
  const triggerLabel = selectedEffort === 'max'
    ? <FireText>{`${eggName} · MAX`}</FireText>
    : selectedEffort === 'xhigh'
      ? <span className="rainbow-text font-normal">{`${eggName} · ULTRATHINK`}</span>
      : undefined

  return (
    <div className="flex items-center gap-1">
      {ultracode && (
        <span title={t('tooltips.ultracode')}>
          <Workflow className="size-3 text-[rgb(var(--ultracode))]" />
        </span>
      )}
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
        optionParams={optionParams}
        onOptionParamChange={(id, value) => { if (id === 'ultracode') setUltracode(value === 'true') }}
        onRefreshModels={() => void refreshClaudeResources(true)}
        modelsLoading={modelsLoading}
        triggerLabel={triggerLabel}
        onCloseAutoFocus={onCloseAutoFocus}
        {...providerProps}
      />
    </div>
  )
}
