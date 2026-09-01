import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { DefaultProviderRow, ProviderOptionLabel } from '@/components/providers/DefaultProviderRow'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { CodexImportConfigSection } from '@/components/CodexImportConfigSection'
import { CodexRealtimeVoicePreference } from '@/components/CodexRealtimeVoicePreference'
import { formatCodexModelName, formatReasoningEffortLabel } from '@/components/chat/chat-input-utils'
import { CodexPermissionPresetList, codexPermissionPresetOptions } from '@/components/chat/CodexPermissionPresetList'
import { CodexModelList, CodexReasoningEffortList } from '@/components/chat/ModelSelectorLists'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { invalidateDefaultCodexPreferencesCache, resolveCodexReasoningEffort, useChatStore } from '@/stores/chat'
import { DEFAULT_CODEX_PERMISSION_PRESET, type CodexPermissionPreset, type CodexReasoningEffort, type ModelOption } from '@superone/shared/agent-types'

export function CodexPreferencesPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const bindings = useSettingsStore((s) => s.bindings)
  const loadCodexModels = useChatStore((s) => s.loadCodexModels)
  const defaultProviderId = bindings.find((binding) => binding.consumer === 'chat:codex')?.credentialId ?? null

  const [scope, setScope] = useState<ResourceScopeView>('user')
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<CodexReasoningEffort | ''>('')
  const [defaultPermissionPreset, setDefaultPermissionPreset] = useState<CodexPermissionPreset | ''>('')
  const [defaultFastMode, setDefaultFastMode] = useState(false)
  const [realtimeVoice, setRealtimeVoice] = useState('')
  const [codexModels, setCodexModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    window.app.getAppSettings()
      .then((settings) => {
        if (!mounted) return
        setDefaultModel(settings.agentPreference.codex.defaultModel)
        setDefaultReasoningEffort(settings.agentPreference.codex.defaultReasoningEffort)
        setDefaultPermissionPreset(settings.agentPreference.codex.defaultPermissionPreset)
        setDefaultFastMode(settings.agentPreference.codex.defaultFastMode)
        setRealtimeVoice(settings.agentPreference.codex.realtimeVoice)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    let mounted = true
    if (!currentFolder) {
      setCodexModels([])
      setModelsLoading(false)
      return () => { mounted = false }
    }
    setModelsLoading(true)
    loadCodexModels(currentFolder, defaultProviderId)
      .then((models) => {
        if (!mounted) return
        setCodexModels(models)
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setModelsLoading(false)
      })
    return () => { mounted = false }
  }, [currentFolder, defaultProviderId, loadCodexModels])

  const selectedModel = codexModels.find((entry) => entry.id === defaultModel)
  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts ?? []
  const displayedReasoningEffort = selectedModel
    ? (resolveCodexReasoningEffort(selectedModel, defaultReasoningEffort || undefined) ?? '')
    : defaultReasoningEffort
  const disabled = loading || saving
  const pillTriggerClass = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
  const activePermissionPreset = defaultPermissionPreset || DEFAULT_CODEX_PERMISSION_PRESET
  const currentPermissionPreset = codexPermissionPresetOptions.find((option) => option.id === activePermissionPreset) ?? codexPermissionPresetOptions[1]

  async function saveCodexDefaults(patch: {
    defaultModel?: string
    defaultReasoningEffort?: CodexReasoningEffort | ''
    defaultPermissionPreset?: CodexPermissionPreset | ''
    defaultFastMode?: boolean
    realtimeVoice?: string
  }, successMessage: string) {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.app.saveAppSettings({
        agentPreference: {
          codex: {
            defaultModel: patch.defaultModel ?? defaultModel,
            defaultReasoningEffort: patch.defaultReasoningEffort ?? defaultReasoningEffort,
            defaultPermissionPreset: patch.defaultPermissionPreset ?? defaultPermissionPreset,
            defaultFastMode: patch.defaultFastMode ?? defaultFastMode,
            realtimeVoice: patch.realtimeVoice ?? realtimeVoice,
          },
        },
      })
      setDefaultModel(result.agentPreference.codex.defaultModel)
      setDefaultReasoningEffort(result.agentPreference.codex.defaultReasoningEffort)
      setDefaultPermissionPreset(result.agentPreference.codex.defaultPermissionPreset)
      setDefaultFastMode(result.agentPreference.codex.defaultFastMode)
      setRealtimeVoice(result.agentPreference.codex.realtimeVoice)
      await invalidateDefaultCodexPreferencesCache()
      toast.success(successMessage)
      setSaving(false)
    } catch (e) {
      setSaving(false)
      throw e
    }
  }

  async function handleModelSelect(modelId: string) {
    const nextModel = codexModels.find((entry) => entry.id === modelId)
    const nextReasoningEffort = nextModel
      ? (resolveCodexReasoningEffort(nextModel, defaultReasoningEffort || undefined) ?? '')
      : ''
    await saveCodexDefaults(
      { defaultModel: modelId, defaultReasoningEffort: nextReasoningEffort },
      modelId ? t('settings.preferences.defaultModel.codexUpdated') : t('settings.preferences.defaultModel.codexSystemDefault'),
    )
    setModelOpen(false)
  }

  async function handleReasoningEffortSelect(effort: CodexReasoningEffort | '') {
    const nextReasoningEffort = selectedModel
      ? (resolveCodexReasoningEffort(selectedModel, effort || undefined) ?? '')
      : ''
    await saveCodexDefaults(
      { defaultReasoningEffort: nextReasoningEffort },
      nextReasoningEffort ? t('settings.preferences.reasoningEffort.updated') : t('settings.preferences.reasoningEffort.systemDefault'),
    )
    setEffortOpen(false)
  }

  async function handlePermissionPresetSelect(preset: CodexPermissionPreset) {
    await saveCodexDefaults({ defaultPermissionPreset: preset }, t('settings.preferences.permissionMode.updated'))
    setPermissionOpen(false)
  }

  async function handleRealtimeVoiceSelect(voice: string) {
    await saveCodexDefaults(
      { realtimeVoice: voice },
      t('settings.preferences.realtimeVoice.updated', { voice }),
    )
  }

  async function handleFastModeChange(enabled: boolean) {
    await saveCodexDefaults(
      { defaultFastMode: enabled },
      t('settings.preferences.fastMode.updated'),
    )
  }

  const emptyModelsMessage = currentFolder
    ? t('settings.preferences.defaultModel.empty')
    : t('settings.preferences.defaultModel.emptyNoProject')

  return (
    <div className="w-full">
      <ResourceScopeToolbar scope={scope} onScopeChange={setScope} />

      <div className="flex flex-col gap-4">
        {scope === 'user' ? (
          <>
            <div className="rounded-lg border border-border">
              <div className="border-b border-border px-4 py-2">
                <p className="text-xs font-medium text-muted-foreground">{t('settings.preferences.sections.user')}</p>
              </div>
              <DefaultProviderRow
                consumer="chat:codex"
                title={t('settings.preferences.defaultProvider.label')}
                description={t('settings.preferences.defaultProvider.description')}
                fallback={<ProviderOptionLabel brandKey="openai" />}
              />

              <CodexRealtimeVoicePreference
                projectPath={currentFolder}
                value={realtimeVoice}
                disabled={disabled}
                onChange={handleRealtimeVoiceSelect}
              />

              <div className="flex items-center justify-between gap-4 border-b border-border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('settings.preferences.permissionMode.label')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.preferences.permissionMode.description')}</p>
                </div>
                <Popover open={permissionOpen} onOpenChange={setPermissionOpen}>
                  <PopoverTrigger asChild>
                    <button disabled={disabled} className={cn(pillTriggerClass, currentPermissionPreset.triggerToneClass)}>
                      {currentPermissionPreset.triggerIcon}
                      <span>{t(currentPermissionPreset.labelKey)}</span>
                      <ChevronDown className={cn('size-3 transition-transform duration-200', permissionOpen && 'rotate-180')} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" className="w-72 border-border bg-popover p-2">
                    <CodexPermissionPresetList activePreset={activePermissionPreset} onSelect={handlePermissionPresetSelect} />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('settings.preferences.fastMode.label')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.preferences.fastMode.description')}</p>
                </div>
                <Switch
                  checked={defaultFastMode}
                  onCheckedChange={(checked) => void handleFastModeChange(checked)}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('settings.preferences.defaultModel.label')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.preferences.defaultModel.codexDescription')}</p>
                </div>
                <Popover open={modelOpen} onOpenChange={setModelOpen}>
                  <PopoverTrigger asChild>
                    <button disabled={disabled || (modelsLoading && codexModels.length === 0)} className={pillTriggerClass}>
                      <span className="max-w-[160px] truncate">
                        {defaultModel ? formatCodexModelName(selectedModel?.name, defaultModel) : t('common.systemDefault')}
                      </span>
                      <ChevronDown className={cn('size-3 transition-transform duration-200', modelOpen && 'rotate-180')} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" className="max-h-60 w-64 overflow-y-auto border-border bg-card p-1">
                    <CodexModelList
                      title={t('settings.preferences.defaultModel.label')}
                      models={codexModels}
                      activeId={defaultModel}
                      onSelect={handleModelSelect}
                      clearOption={{ label: t('common.systemDefault'), isActive: !defaultModel, onSelect: () => void handleModelSelect('') }}
                      loading={modelsLoading}
                      loadingMessage={t('settings.preferences.defaultModel.loading')}
                      emptyMessage={emptyModelsMessage}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('settings.preferences.reasoningEffort.label')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.preferences.reasoningEffort.description')}</p>
                </div>
                <Popover open={effortOpen} onOpenChange={setEffortOpen}>
                  <PopoverTrigger asChild>
                    <button disabled={disabled || (!selectedModel && !displayedReasoningEffort)} className={pillTriggerClass}>
                      <span className="truncate">
                        {displayedReasoningEffort ? formatReasoningEffortLabel(displayedReasoningEffort) : t('common.systemDefault')}
                      </span>
                      <ChevronDown className={cn('size-3 transition-transform duration-200', effortOpen && 'rotate-180')} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" className="w-48 border-border bg-card p-1">
                    {!selectedModel ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('settings.preferences.effort.chooseModel')}</div>
                    ) : (
                      <CodexReasoningEffortList
                        title={t('settings.preferences.reasoningEffort.label')}
                        options={supportedReasoningEfforts}
                        activeValue={displayedReasoningEffort}
                        onSelect={handleReasoningEffortSelect}
                        clearOption={{ label: t('common.systemDefault'), isActive: !displayedReasoningEffort, onSelect: () => void handleReasoningEffortSelect('') }}
                        emptyMessage={t('settings.preferences.effort.unsupported')}
                      />
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Migration / external-agent import is user-level, not project-scoped. */}
            <CodexImportConfigSection projectPath={currentFolder} />
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('settings.preferences.sections.projectEmptyCodex')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
