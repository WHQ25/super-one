import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { DefaultProviderRow, ProviderOptionLabel } from '@/components/providers/DefaultProviderRow'
import { CodexPreferencesPage } from '@/components/CodexPreferencesPage'
import { useAppStore } from '@/stores/app'
import {
  ResourceScopeToolbar,
  type ResourceScopeView,
} from '@/components/settings/ResourceScopeToolbar'
import { invalidateDefaultClaudePreferencesCache, invalidateDefaultPermissionModeCache, useChatStore, selectClaudeModels, selectClaudeAccount, selectClaudeOutputStyles } from '@/stores/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import {
  ClaudeModelList,
  EffortList,
} from '@/components/chat/ModelSelectorLists'
import { checkAutoModePlanEligibility } from '@/lib/auto-mode-eligibility'
import type { EffortLevel, PermissionMode, QuestionPreviewFormat, SandboxMode } from '@superone/shared/agent-types'
import { HarnessPreferencesPage, SessionDefaultsSection } from '@/components/preferences/SessionDefaultsSection'

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
  const availableOutputStyles = useChatStore(selectClaudeOutputStyles)
  const availableModels = useChatStore(selectClaudeModels)
  const account = useChatStore(selectClaudeAccount)
  const autoPlanEligibility = checkAutoModePlanEligibility(account)

  const [scope, setScope] = useState<ResourceScopeView>('user')
  const [outputStyle, setOutputStyle] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel | ''>('')
  const [askPreviewFormat, setAskPreviewFormat] = useState<QuestionPreviewFormat>('markdown')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
      setDefaultModel(claude.defaultModel)
      setDefaultEffort(claude.defaultEffort)
      setAskPreviewFormat(claude.askUserQuestionPreviewFormat)
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [currentFolder])

  async function saveClaudeDefaults(patch: {
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
            defaultModel: patch.defaultModel ?? defaultModel,
            defaultEffort: patch.defaultEffort ?? defaultEffort,
            askUserQuestionPreviewFormat: patch.askUserQuestionPreviewFormat ?? askPreviewFormat,
          },
        },
      })
      const claude = result.agentPreference.claude
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
  const pillTriggerClass = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="w-full">
      <ResourceScopeToolbar scope={scope} onScopeChange={setScope} />

      <div className="space-y-4">
        {scope === 'project' ? (
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
        ) : (
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
            {/* Permission mode and sandbox are per harness now, so both rows
                come from the shared section every harness page renders. Auto's
                plan-eligibility gate is Claude's own knowledge, so it is passed
                in rather than rediscovered inside a generic component. */}
            <SessionDefaultsSection harnessId="claude" autoEligibility={autoPlanEligibility} />

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
        )}
      </div>
    </div>
  )
}

export function PreferencesPage() {
  const settingsProvider = useAppStore((s) => s.settingsProvider)

  if (settingsProvider === 'codex') return <CodexPreferencesPage />
  if (settingsProvider === 'claude') return <ClaudePreferencesPage />
  // Everything else has exactly one app-level setting group — its session
  // defaults — so it renders the shared page rather than a bespoke one.
  return <HarnessPreferencesPage harnessId={settingsProvider} />
}
