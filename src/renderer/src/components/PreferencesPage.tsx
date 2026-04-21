import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { formatCodexModelLabel, formatReasoningEffortLabel } from '@/components/chat/chat-input-utils'
import { useAppStore } from '@/stores/app'
import { invalidateDefaultClaudePreferencesCache, invalidateDefaultCodexPreferencesCache, invalidateDefaultPermissionModeCache, resolveCodexReasoningEffort, useChatStore } from '@/stores/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { modes as permissionModes } from '@/components/chat/PermissionModeSelector'
import { PermissionModeList } from '@/components/chat/PermissionModeList'
import { sandboxModes } from '@/components/chat/SandboxModeSelector'
import { checkAutoModePlanEligibility } from '@/lib/auto-mode-eligibility'
import type { CodexReasoningEffort, EffortLevel, ModelOption, PermissionMode, SandboxMode } from '../../../shared/agent-types'

const CLAUDE_EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

function ClaudePreferencesPage() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const availableOutputStyles = useChatStore((s) => s.availableOutputStyles)
  const availableModels = useChatStore((s) => s.availableModels)
  const account = useChatStore((s) => s.account)
  const autoPlanEligibility = checkAutoModePlanEligibility(account)

  const [outputStyle, setOutputStyle] = useState('')
  const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode | ''>('')
  const [defaultSandboxMode, setDefaultSandboxMode] = useState<SandboxMode | ''>('')
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)

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
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [currentFolder])

  async function saveClaudeDefaults(patch: {
    defaultPermissionMode?: PermissionMode | ''
    defaultSandboxMode?: SandboxMode | ''
    defaultModel?: string
    defaultEffort?: EffortLevel | ''
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
          },
        },
      })
      const claude = result.agentPreference.claude
      setDefaultPermissionMode(claude.defaultPermissionMode)
      setDefaultSandboxMode(claude.defaultSandboxMode)
      setDefaultModel(claude.defaultModel)
      setDefaultEffort(claude.defaultEffort)
      invalidateDefaultClaudePreferencesCache()
      toast.success(successMessage)
    } finally {
      setSaving(false)
    }
  }

  async function handleOutputStyleSelect(style: string) {
    if (!currentFolder || saving) return
    setSaving(true)
    try {
      const result = await window.app.saveProjectPreferences(currentFolder, { outputStyle: style })
      setOutputStyle(result.outputStyle)
      toast.success('Output style updated')
    } finally {
      setSaving(false)
    }
  }

  async function handlePermissionModeSelect(mode: PermissionMode) {
    try {
      await saveClaudeDefaults({ defaultPermissionMode: mode }, 'Default permission mode updated')
      invalidateDefaultPermissionModeCache()
    } finally {
      setPermOpen(false)
    }
  }

  async function handleSandboxModeSelect(mode: SandboxMode) {
    try {
      await saveClaudeDefaults({ defaultSandboxMode: mode }, 'Default sandbox mode updated')
    } finally {
      setSandboxOpen(false)
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
      modelId ? 'Default Claude model updated' : 'Default Claude model cleared',
    )
  }

  async function handleEffortSelect(effort: EffortLevel | '') {
    await saveClaudeDefaults(
      { defaultEffort: effort },
      effort ? 'Default thinking effort updated' : 'Default thinking effort cleared',
    )
  }

  const disabled = loading || saving
  const activePermMode = defaultPermissionMode || 'default'
  const activeSandboxMode = defaultSandboxMode || 'on'
  const currentPerm = permissionModes.find((m) => m.id === activePermMode) ?? permissionModes[0]
  const currentSandbox = sandboxModes.find((m) => m.id === activeSandboxMode) ?? sandboxModes[1]

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Preferences</h2>
          <p className="text-sm text-muted-foreground">Configure Claude Code behavior</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">Project Settings</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Output Style</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Controls how Claude formats responses - tone, structure, and level of detail.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled || !currentFolder}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">{outputStyle || 'Default'}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleOutputStyleSelect('')} className="flex items-center justify-between">
                  <span>Default</span>
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
            <p className="text-xs font-medium text-muted-foreground">User Settings</p>
          </div>
          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Permission Mode</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Default permission mode when starting a new session.
              </p>
            </div>
            <Popover open={permOpen} onOpenChange={setPermOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentPerm.color} ${currentPerm.hoverBg}`}
                >
                  {currentPerm.icon}
                  <span>{currentPerm.label}</span>
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
              <p className="text-sm font-medium">Sandbox</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Default sandbox mode when starting a new session.
              </p>
            </div>
            <Popover open={sandboxOpen} onOpenChange={setSandboxOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentSandbox.color} ${currentSandbox.hoverBg}`}
                >
                  {currentSandbox.icon}
                  <span>{currentSandbox.label}</span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${sandboxOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-56 border-border bg-card p-1">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Sandbox Mode</div>
                {sandboxModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => handleSandboxModeSelect(mode.id)}
                    className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      mode.id === activeSandboxMode
                        ? 'bg-muted text-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                      {mode.icon}
                      {mode.label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{mode.description}</div>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Default Model</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Applied to sessions that have not picked a model.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled || availableModels.length === 0}
                  className="flex min-w-48 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">
                    {selectedDefaultModel?.name ?? (defaultModel || 'Not set')}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => handleModelSelect('')} className="flex items-center justify-between">
                  <span>Not set</span>
                  {!defaultModel && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                {availableModels.length === 0 && (
                  <DropdownMenuItem disabled>No models available</DropdownMenuItem>
                )}
                {availableModels.map((model) => (
                  <DropdownMenuItem key={model.id} onClick={() => handleModelSelect(model.id)} className="flex items-center justify-between">
                    <span className="truncate">{model.name}</span>
                    {defaultModel === model.id && <Check className="size-4 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Default Thinking Effort</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Applied when the selected default model supports effort selection.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled || !selectedDefaultModel || supportedEffortLevels.length === 0}
                  className="flex min-w-40 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">
                    {displayedEffort ? CLAUDE_EFFORT_LABELS[displayedEffort] : 'Not set'}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleEffortSelect('')} className="flex items-center justify-between">
                  <span>Not set</span>
                  {!displayedEffort && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                {!selectedDefaultModel && (
                  <DropdownMenuItem disabled>Choose a default model first</DropdownMenuItem>
                )}
                {selectedDefaultModel && supportedEffortLevels.length === 0 && (
                  <DropdownMenuItem disabled>This model does not expose effort options</DropdownMenuItem>
                )}
                {supportedEffortLevels.map((level) => (
                  <DropdownMenuItem key={level} onClick={() => handleEffortSelect(level)} className="flex items-center justify-between">
                    <span>{CLAUDE_EFFORT_LABELS[level]}</span>
                    {displayedEffort === level && <Check className="size-4 text-muted-foreground" />}
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
  const currentFolder = useAppStore((s) => s.currentFolder)
  const cachedCodexModels = useChatStore((s) => s.cachedCodexModels)

  const [defaultModel, setDefaultModel] = useState('')
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<CodexReasoningEffort | ''>('')
  const [codexModels, setCodexModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)

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
    } finally {
      setSaving(false)
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
      modelId ? 'Default Codex model updated' : 'Default Codex model cleared',
    )
  }

  async function handleReasoningEffortSelect(effort: CodexReasoningEffort | '') {
    const nextReasoningEffort = selectedModel
      ? (resolveCodexReasoningEffort(selectedModel, effort || undefined) ?? '')
      : ''
    await saveCodexDefaults(
      { defaultReasoningEffort: nextReasoningEffort },
      nextReasoningEffort ? 'Default reasoning effort updated' : 'Default reasoning effort cleared',
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Preferences</h2>
          <p className="text-sm text-muted-foreground">Configure Codex defaults for new sessions</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">User Settings</p>
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Default Model</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Applied to new Codex sessions inside SuperOne. This does not modify local Codex settings.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled || (modelsLoading && codexModels.length === 0)}
                  className="flex min-w-48 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">
                    {defaultModel ? formatCodexModelLabel(defaultModel) : 'Not set'}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => handleModelSelect('')} className="flex items-center justify-between">
                  <span>Not set</span>
                  {!defaultModel && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                {modelsLoading && codexModels.length === 0 && (
                  <DropdownMenuItem disabled>Loading models...</DropdownMenuItem>
                )}
                {!modelsLoading && codexModels.length === 0 && (
                  <DropdownMenuItem disabled>{currentFolder ? 'No models available' : 'Open a project to load models'}</DropdownMenuItem>
                )}
                {codexModels.map((model) => (
                  <DropdownMenuItem key={model.id} onClick={() => handleModelSelect(model.id)} className="flex items-center justify-between">
                    <span>{formatCodexModelLabel(model.id || model.name)}</span>
                    {defaultModel === model.id && <Check className="size-4 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Default Reasoning Effort</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Applied when the selected default model supports reasoning effort selection.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={disabled || (!selectedModel && !displayedReasoningEffort)}
                  className="flex min-w-40 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">
                    {displayedReasoningEffort ? formatReasoningEffortLabel(displayedReasoningEffort) : 'Not set'}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleReasoningEffortSelect('')} className="flex items-center justify-between">
                  <span>Not set</span>
                  {!displayedReasoningEffort && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                {!selectedModel && (
                  <DropdownMenuItem disabled>Choose a default model first</DropdownMenuItem>
                )}
                {selectedModel && supportedReasoningEfforts.length === 0 && (
                  <DropdownMenuItem disabled>This model does not expose effort options</DropdownMenuItem>
                )}
                {supportedReasoningEfforts.map((option) => (
                  <DropdownMenuItem key={option.value} onClick={() => handleReasoningEffortSelect(option.value)} className="flex items-center justify-between">
                    <span>{formatReasoningEffortLabel(option.value)}</span>
                    {displayedReasoningEffort === option.value && <Check className="size-4 text-muted-foreground" />}
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

export function PreferencesPage() {
  const settingsProvider = useAppStore((s) => s.settingsProvider)

  if (settingsProvider === 'codex') {
    return <CodexPreferencesPage />
  }

  return <ClaudePreferencesPage />
}
