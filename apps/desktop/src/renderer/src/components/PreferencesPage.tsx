import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings'
import { DefaultProviderRow, ProviderOptionLabel } from '@/components/providers/DefaultProviderRow'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { CodexImportConfigSection } from '@/components/CodexImportConfigSection'
import { formatCodexModelLabel, formatReasoningEffortLabel } from '@/components/chat/chat-input-utils'
import { useAppStore } from '@/stores/app'
import { invalidateDefaultClaudePreferencesCache, invalidateDefaultCodexPreferencesCache, invalidateDefaultPermissionModeCache, resolveCodexReasoningEffort, useChatStore, selectClaudeModels, selectCodexModels, selectClaudeAccount, selectClaudeOutputStyles } from '@/stores/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { modes as permissionModes } from '@/components/chat/PermissionModeSelector'
import { PermissionModeList } from '@/components/chat/PermissionModeList'
import { sandboxModes } from '@/components/chat/SandboxModeSelector'
import {
  ClaudeModelList,
  CodexModelList,
  CodexReasoningEffortList,
  EffortList,
} from '@/components/chat/ModelSelectorLists'
import { checkAutoModePlanEligibility } from '@/lib/auto-mode-eligibility'
import type { CodexReasoningEffort, EffortLevel, ModelOption, PermissionMode, QuestionPreviewFormat, SandboxMode } from '@superone/shared/agent-types'

import type { SandboxProbeResult, SandboxSupportLevel } from '@superone/shared/agent-types'

interface SandboxStatusBlockProps {
  supportLevel: SandboxSupportLevel
  probe: SandboxProbeResult | null
  capabilityReason?: string
  onProbe: () => void
}

function SandboxStatusBlock({ supportLevel, probe, capabilityReason, onProbe }: SandboxStatusBlockProps) {
  const { t } = useTranslation()
  if (supportLevel === 'unsupported') {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        {capabilityReason ?? t('settings.preferences.sandbox.statusUnsupported')}
      </div>
    )
  }
  if (probe === null) {
    return (
      <div className="m-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span>{t('settings.preferences.sandbox.statusNotProbed')}</span>
        <button
          onClick={onProbe}
          className="rounded border border-border bg-card px-2 py-1 text-foreground hover:bg-muted"
        >
          {t('settings.preferences.sandbox.probeNow')}
        </button>
      </div>
    )
  }
  if (probe.ok) {
    return (
      <div className="m-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
        {t('settings.preferences.sandbox.statusReady')}
      </div>
    )
  }
  return (
    <div className="m-4 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
      <div className="font-medium">
        {t('settings.preferences.sandbox.statusMissing', { missing: probe.missing.join(', ') })}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('settings.preferences.sandbox.installHintTitle')}
        </div>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-card p-2 text-[11px] text-foreground">{probe.installHint}</pre>
      </div>
      <button
        onClick={onProbe}
        className="rounded border border-border bg-card px-2 py-1 text-foreground hover:bg-muted"
      >
        {t('settings.preferences.sandbox.reProbe')}
      </button>
    </div>
  )
}

function ClaudePreferencesPage() {
  const { t } = useTranslation()
  const CLAUDE_EFFORT_LABELS: Record<EffortLevel, string> = {
    low: t('settings.preferences.effort.levels.low'),
    medium: t('settings.preferences.effort.levels.medium'),
    high: t('settings.preferences.effort.levels.high'),
    xhigh: t('settings.preferences.effort.levels.xhigh'),
    max: t('settings.preferences.effort.levels.max'),
  }
  const currentFolder = useAppStore((s) => s.currentFolder)
  const sandboxCapability = useAppStore((s) => s.sandboxCapability)
  const sandboxProbe = useAppStore((s) => s.sandboxProbe)
  const probeSandbox = useAppStore((s) => s.probeSandbox)
  const availableOutputStyles = useChatStore(selectClaudeOutputStyles)
  const availableModels = useChatStore(selectClaudeModels)
  const account = useChatStore(selectClaudeAccount)
  const autoPlanEligibility = checkAutoModePlanEligibility(account)

  const [outputStyle, setOutputStyle] = useState('')
  const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode | ''>('')
  const [defaultSandboxMode, setDefaultSandboxMode] = useState<SandboxMode | ''>('')
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel | ''>('')
  const [askPreviewFormat, setAskPreviewFormat] = useState<QuestionPreviewFormat>('markdown')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([
      currentFolder ? window.app.getProjectPreferences(currentFolder) : Promise.resolve(null),
      window.app.getAppSettings(),
    ]).then(([projectPrefs, appSettings]) => {
      if (!mounted) return
      if (projectPrefs) setOutputStyle(projectPrefs.outputStyle)
      const claude = appSettings.agentPreference.claude
      setDefaultPermissionMode(claude.defaultPermissionMode)
      setDefaultSandboxMode(claude.defaultSandboxMode)
      setDefaultModel(claude.defaultModel)
      setDefaultEffort(claude.defaultEffort)
      setAskPreviewFormat(claude.askUserQuestionPreviewFormat)
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [currentFolder])

  async function saveClaudeDefaults(patch: {
    defaultPermissionMode?: PermissionMode | ''
    defaultSandboxMode?: SandboxMode | ''
    defaultModel?: string
    defaultEffort?: EffortLevel | ''
    askUserQuestionPreviewFormat?: QuestionPreviewFormat
  }, successMessage: string) {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.app.saveAppSettings({
        agentPreference: {
          claude: {
            defaultPermissionMode: patch.defaultPermissionMode ?? defaultPermissionMode,
            defaultSandboxMode: patch.defaultSandboxMode ?? defaultSandboxMode,
            defaultModel: patch.defaultModel ?? defaultModel,
            defaultEffort: patch.defaultEffort ?? defaultEffort,
            askUserQuestionPreviewFormat: patch.askUserQuestionPreviewFormat ?? askPreviewFormat,
          },
        },
      })
      const claude = result.agentPreference.claude
      setDefaultPermissionMode(claude.defaultPermissionMode)
      setDefaultSandboxMode(claude.defaultSandboxMode)
      setDefaultModel(claude.defaultModel)
      setDefaultEffort(claude.defaultEffort)
      setAskPreviewFormat(claude.askUserQuestionPreviewFormat)
      invalidateDefaultClaudePreferencesCache()
      toast.success(successMessage)
      setSaving(false)
    } catch (e) {
      setSaving(false)
      throw e
    }
  }

  async function handleOutputStyleSelect(style: string) {
    if (!currentFolder || saving) return
    setSaving(true)
    try {
      const result = await window.app.saveProjectPreferences(currentFolder, { outputStyle: style })
      setOutputStyle(result.outputStyle)
      toast.success(t('settings.preferences.outputStyle.updated'))
      setSaving(false)
    } catch (e) {
      setSaving(false)
      throw e
    }
  }

  async function handlePermissionModeSelect(mode: PermissionMode) {
    try {
      await saveClaudeDefaults({ defaultPermissionMode: mode }, t('settings.preferences.permissionMode.updated'))
      invalidateDefaultPermissionModeCache()
      setPermOpen(false)
    } catch (e) {
      setPermOpen(false)
      throw e
    }
  }

  async function handleSandboxModeSelect(mode: SandboxMode) {
    try {
      await saveClaudeDefaults({ defaultSandboxMode: mode }, t('settings.preferences.sandbox.updated'))
      setSandboxOpen(false)
    } catch (e) {
      setSandboxOpen(false)
      throw e
    }
  }

  const selectedDefaultModel = availableModels.find((m) => m.id === defaultModel)
  const supportedEffortLevels = selectedDefaultModel?.supportedEffortLevels ?? []
  const displayedEffort: EffortLevel | '' =
    defaultEffort && supportedEffortLevels.includes(defaultEffort) ? defaultEffort : ''

  async function handleModelSelect(modelId: string) {
    const nextModel = availableModels.find((m) => m.id === modelId)
    const nextEffort: EffortLevel | '' =
      nextModel && defaultEffort && nextModel.supportedEffortLevels?.includes(defaultEffort)
        ? defaultEffort
        : ''
    await saveClaudeDefaults(
      { defaultModel: modelId, defaultEffort: nextEffort },
      modelId ? t('settings.preferences.defaultModel.claudeUpdated') : t('settings.preferences.defaultModel.claudeSystemDefault'),
    )
    setModelOpen(false)
  }

  async function handleEffortSelect(effort: EffortLevel | '') {
    await saveClaudeDefaults(
      { defaultEffort: effort },
      effort ? t('settings.preferences.effort.updated') : t('settings.preferences.effort.systemDefault'),
    )
    setEffortOpen(false)
  }

  async function handleAskPreviewFormatSelect(format: QuestionPreviewFormat) {
    await saveClaudeDefaults(
      { askUserQuestionPreviewFormat: format },
      t('settings.preferences.askPreviewFormat.updated'),
    )
  }

  const disabled = loading || saving
  const sandboxSupportLevel = sandboxCapability?.supportLevel ?? 'always'
  const fallbackSandboxMode: SandboxMode = sandboxCapability?.defaultMode ?? 'on'
  const activePermMode = defaultPermissionMode || 'default'
  const activeSandboxMode = defaultSandboxMode || fallbackSandboxMode
  const currentPerm = permissionModes.find((m) => m.id === activePermMode) ?? permissionModes[0]
  const currentSandbox = sandboxModes.find((m) => m.id === activeSandboxMode) ?? sandboxModes[1]
  const sandboxOptionDisabled = (id: SandboxMode): boolean =>
    id !== 'off' && sandboxSupportLevel === 'unsupported'
  const sandboxTriggerDisabled = disabled || sandboxSupportLevel === 'unsupported'
  const pillTriggerClass = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.preferences.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.preferences.claudeSubtitle')}</p>
        </div>
        <ProjectSelector />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.preferences.sections.project')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.outputStyle.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.outputStyle.description')}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled || !currentFolder}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">{outputStyle || t('settings.preferences.outputStyle.defaultName')}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleOutputStyleSelect('')} className="flex items-center justify-between">
                  <span>{t('settings.preferences.outputStyle.defaultName')}</span>
                  {!outputStyle && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                {availableOutputStyles.filter((s) => s.toLowerCase() !== 'default').map((style) => (
                  <DropdownMenuItem key={style} onClick={() => handleOutputStyleSelect(style)} className="flex items-center justify-between">
                    <span>{style}</span>
                    {outputStyle === style && <Check className="size-4 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.preferences.sections.user')}</p>
          </div>
          <DefaultProviderRow
            consumer="chat:claude"
            title={t('settings.preferences.defaultProvider.label')}
            description={t('settings.preferences.defaultProvider.description')}
            fallback={<ProviderOptionLabel brandKey="claude" />}
          />
          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.permissionMode.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.permissionMode.description')}
              </p>
            </div>
            <Popover open={permOpen} onOpenChange={setPermOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentPerm.color} ${currentPerm.hoverBg}`}
                >
                  {currentPerm.icon}
                  <span>{t(`chat.permissionModes.${currentPerm.id}.label`)}</span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${permOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-52 border-border bg-card p-1">
                <PermissionModeList
                  activeMode={activePermMode}
                  autoEligibility={autoPlanEligibility}
                  onSelect={handlePermissionModeSelect}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.sandbox.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.sandbox.description')}
              </p>
            </div>
            <Popover open={sandboxOpen} onOpenChange={setSandboxOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={sandboxTriggerDisabled}
                  title={sandboxSupportLevel === 'unsupported' ? t('settings.preferences.sandbox.statusUnsupported') : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentSandbox.color} ${currentSandbox.hoverBg}`}
                >
                  {currentSandbox.icon}
                  <span>{t(`chat.sandboxModes.${currentSandbox.id}.label`)}</span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${sandboxOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-56 border-border bg-card p-1">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('settings.preferences.sandbox.menuTitle')}</div>
                {sandboxModes.map((mode) => {
                  const isDisabled = sandboxOptionDisabled(mode.id)
                  return (
                    <button
                      key={mode.id}
                      disabled={isDisabled}
                      aria-disabled={isDisabled}
                      onClick={() => { if (!isDisabled) void handleSandboxModeSelect(mode.id) }}
                      title={isDisabled ? t('settings.preferences.sandbox.statusUnsupported') : undefined}
                      className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                        mode.id === activeSandboxMode
                          ? 'bg-muted text-foreground'
                          : 'text-foreground hover:bg-muted/50'
                      } ${isDisabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
                    >
                      <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                        {mode.icon}
                        {t(`chat.sandboxModes.${mode.id}.label`)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{t(`chat.sandboxModes.${mode.id}.description`)}</div>
                    </button>
                  )
                })}
              </PopoverContent>
            </Popover>
          </div>
          {sandboxSupportLevel !== 'always' && (
            <SandboxStatusBlock
              supportLevel={sandboxSupportLevel}
              probe={sandboxProbe}
              capabilityReason={sandboxCapability?.unsupportedReason}
              onProbe={() => { void probeSandbox(true) }}
            />
          )}

          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.defaultModel.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.defaultModel.claudeDescription')}
              </p>
            </div>
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled || availableModels.length === 0}
                  className={pillTriggerClass}
                >
                  <span className="max-w-[160px] truncate">
                    {selectedDefaultModel?.name ?? (defaultModel || t('common.systemDefault'))}
                  </span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-64 max-h-60 overflow-y-auto border-border bg-card p-1">
                <ClaudeModelList
                  title={t('settings.preferences.defaultModel.label')}
                  models={availableModels}
                  activeId={defaultModel}
                  onSelect={handleModelSelect}
                  clearOption={{
                    label: t('common.systemDefault'),
                    isActive: !defaultModel,
                    onSelect: () => void handleModelSelect(''),
                  }}
                  emptyMessage={t('settings.preferences.defaultModel.empty')}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.effort.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.effort.description')}
              </p>
            </div>
            <Popover open={effortOpen} onOpenChange={setEffortOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled || !selectedDefaultModel || supportedEffortLevels.length === 0}
                  className={pillTriggerClass}
                >
                  <span className="truncate">
                    {displayedEffort ? CLAUDE_EFFORT_LABELS[displayedEffort] : t('common.systemDefault')}
                  </span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-48 border-border bg-card p-1">
                {!selectedDefaultModel ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t('settings.preferences.effort.chooseModel')}
                  </div>
                ) : (
                  <EffortList
                    title={t('settings.preferences.effort.label')}
                    levels={supportedEffortLevels}
                    labels={CLAUDE_EFFORT_LABELS}
                    activeLevel={displayedEffort}
                    onSelect={handleEffortSelect}
                    clearOption={{
                      label: t('common.systemDefault'),
                      isActive: !displayedEffort,
                      onSelect: () => void handleEffortSelect(''),
                    }}
                    emptyMessage={t('settings.preferences.effort.unsupported')}
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.askPreviewFormat.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.askPreviewFormat.description')}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">{t(`settings.preferences.askPreviewFormat.options.${askPreviewFormat}`)}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(['markdown', 'html'] as const).map((format) => (
                  <DropdownMenuItem
                    key={format}
                    onClick={() => void handleAskPreviewFormatSelect(format)}
                    className="flex items-center justify-between"
                  >
                    <span>{t(`settings.preferences.askPreviewFormat.options.${format}`)}</span>
                    {askPreviewFormat === format && <Check className="size-4 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

function CodexPreferencesPage() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const cachedCodexModels = useChatStore(selectCodexModels)

  const [defaultModel, setDefaultModel] = useState('')
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<CodexReasoningEffort | ''>('')
  const [codexModels, setCodexModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    window.app.getAppSettings()
      .then((settings) => {
        if (!mounted) return
        setDefaultModel(settings.agentPreference.codex.defaultModel)
        setDefaultReasoningEffort(settings.agentPreference.codex.defaultReasoningEffort)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    let mounted = true
    setCodexModels(cachedCodexModels)
    if (!currentFolder) return () => { mounted = false }
    setModelsLoading(true)
    window.app.codexListModels(currentFolder)
      .then((models) => {
        if (!mounted) return
        setCodexModels(models)
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setModelsLoading(false)
      })
    return () => { mounted = false }
  }, [cachedCodexModels, currentFolder])

  const selectedModel = codexModels.find((entry) => entry.id === defaultModel)
  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts ?? []
  const displayedReasoningEffort = selectedModel
    ? (resolveCodexReasoningEffort(selectedModel, defaultReasoningEffort || undefined) ?? '')
    : defaultReasoningEffort
  const disabled = loading || saving
  const pillTriggerClass = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'

  async function saveCodexDefaults(patch: {
    defaultModel?: string
    defaultReasoningEffort?: CodexReasoningEffort | ''
  }, successMessage: string) {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.app.saveAppSettings({
        agentPreference: {
          codex: {
            defaultModel: patch.defaultModel ?? defaultModel,
            defaultReasoningEffort: patch.defaultReasoningEffort ?? defaultReasoningEffort,
          },
        },
      })
      setDefaultModel(result.agentPreference.codex.defaultModel)
      setDefaultReasoningEffort(result.agentPreference.codex.defaultReasoningEffort)
      invalidateDefaultCodexPreferencesCache()
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
      {
        defaultModel: modelId,
        defaultReasoningEffort: nextReasoningEffort,
      },
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

  const emptyModelsMessage = currentFolder
    ? t('settings.preferences.defaultModel.empty')
    : t('settings.preferences.defaultModel.emptyNoProject')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.preferences.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.preferences.codexSubtitle')}</p>
        </div>
        <ProjectSelector />
      </div>

      <div className="space-y-4">
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

          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.preferences.defaultModel.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.defaultModel.codexDescription')}
              </p>
            </div>
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled || (modelsLoading && codexModels.length === 0)}
                  className={pillTriggerClass}
                >
                  <span className="max-w-[160px] truncate">
                    {defaultModel ? formatCodexModelLabel(defaultModel) : t('common.systemDefault')}
                  </span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-64 max-h-60 overflow-y-auto border-border bg-card p-1">
                <CodexModelList
                  title={t('settings.preferences.defaultModel.label')}
                  models={codexModels}
                  activeId={defaultModel}
                  onSelect={handleModelSelect}
                  clearOption={{
                    label: t('common.systemDefault'),
                    isActive: !defaultModel,
                    onSelect: () => void handleModelSelect(''),
                  }}
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
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.preferences.reasoningEffort.description')}
              </p>
            </div>
            <Popover open={effortOpen} onOpenChange={setEffortOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled || (!selectedModel && !displayedReasoningEffort)}
                  className={pillTriggerClass}
                >
                  <span className="truncate">
                    {displayedReasoningEffort ? formatReasoningEffortLabel(displayedReasoningEffort) : t('common.systemDefault')}
                  </span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-48 border-border bg-card p-1">
                {!selectedModel ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t('settings.preferences.effort.chooseModel')}
                  </div>
                ) : (
                  <CodexReasoningEffortList
                    title={t('settings.preferences.reasoningEffort.label')}
                    options={supportedReasoningEfforts}
                    activeValue={displayedReasoningEffort}
                    onSelect={handleReasoningEffortSelect}
                    clearOption={{
                      label: t('common.systemDefault'),
                      isActive: !displayedReasoningEffort,
                      onSelect: () => void handleReasoningEffortSelect(''),
                    }}
                    emptyMessage={t('settings.preferences.effort.unsupported')}
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <CodexImportConfigSection projectPath={currentFolder} />
      </div>
    </div>
  )
}

export function PreferencesPage() {
  const settingsProvider = useAppStore((s) => s.settingsProvider)

  if (settingsProvider === 'codex') {
    return <CodexPreferencesPage />
  }

  return <ClaudePreferencesPage />
}
