import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, Loader2, Zap } from 'lucide-react'
import { formatCodexModelLabel, formatReasoningEffortLabel } from './chat-input-utils'
import { CodexModeSelector } from './CodexModeSelector'
import { FireText } from './FireText'
import {
  ClaudeModelList,
  CodexModelList,
  CodexReasoningEffortList,
  EffortList,
  resolveClaudeDisplayName,
} from './ModelSelectorLists'
import type { AgentProviderConfig, EffortLevel } from '../../../../shared/agent-types'
import { parseProviderModelEnv } from '../../../../shared/agent-types'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

export function ModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  const selectedModel = useActiveSession((s) => s.selectedModel)
  const selectedEffort = useActiveSession((s) => s.selectedEffort)
  const selectedCodexModel = useActiveSession((s) => s.selectedCodexModel)
  const selectedCodexReasoningEffort = useActiveSession((s) => s.selectedCodexReasoningEffort)
  const codexModels = useActiveSession((s) => s.codexModels)
  const codexModelsLoading = useActiveSession((s) => s.codexModelsLoading)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const availableModels = useChatStore((s) => s.availableModels)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const setSelectedEffort = useChatStore((s) => s.setSelectedEffort)
  const setSelectedCodexModel = useChatStore((s) => s.setSelectedCodexModel)
  const setSelectedCodexReasoningEffort = useChatStore((s) => s.setSelectedCodexReasoningEffort)
  const refreshCodexModels = useChatStore((s) => s.refreshCodexModels)

  const activeProvider = sessionProvider ?? preferredProvider

  const providers = useSettingsStore((s) => s.providers)
  const fetchProviders = useSettingsStore((s) => s.fetchProviders)
  useEffect(() => { void fetchProviders() }, [fetchProviders])
  const activeApiProvider = useMemo(
    () => providers.find((p) => p.is_active_claude === 1) ?? null,
    [providers],
  )
  const activeModelEnv = useMemo(() => {
    if (!activeApiProvider) return null
    try {
      const configs = JSON.parse(activeApiProvider.agent_configs || '{}') as Record<string, AgentProviderConfig>
      const claudeConfig = configs.claude
      if (!claudeConfig) return null
      const parsed = parseProviderModelEnv(claudeConfig.model_env)
      return Object.keys(parsed).length > 0 ? parsed : null
    } catch {
      return null
    }
  }, [activeApiProvider])

  const forcedEffort = useMemo<EffortLevel | 'auto' | null>(() => {
    if (!activeApiProvider) return null
    try {
      const configs = JSON.parse(activeApiProvider.agent_configs || '{}') as Record<string, AgentProviderConfig>
      const claudeConfig = configs.claude
      if (!claudeConfig) return null
      const extraEnv = JSON.parse(claudeConfig.extra_env || '{}') as Record<string, string>
      const raw = (extraEnv.CLAUDE_CODE_EFFORT_LEVEL ?? '').toLowerCase().trim()
      if (!raw) return null
      if (raw === 'auto') return 'auto'
      if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw
      return null
    } catch {
      return null
    }
  }, [activeApiProvider])

  const forcedEffortLabel = forcedEffort === 'auto' ? 'Auto' : forcedEffort ? EFFORT_LABELS[forcedEffort] : null

  const fastModeState = useActiveSession((s) => s.session?.fastModeState)

  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const currentModelName = resolveClaudeDisplayName(currentModel, activeModelEnv) ?? selectedModel ?? null
  const effortLevels = currentModel?.supportedEffortLevels
  const currentEffortLabel = selectedEffort ? EFFORT_LABELS[selectedEffort] : null

  const selectedCodexModelOption = codexModels.find((m) => m.id === selectedCodexModel)
  const currentCodexModelName =
    selectedCodexModelOption
      ? formatCodexModelLabel(selectedCodexModelOption.id || selectedCodexModelOption.name)
      : selectedCodexModel
        ? formatCodexModelLabel(selectedCodexModel)
        : null
  const codexReasoningEfforts = selectedCodexModelOption?.supportedReasoningEfforts ?? []
  const currentCodexReasoningEffort =
    selectedCodexReasoningEffort
    ?? selectedCodexModelOption?.defaultReasoningEffort
    ?? codexReasoningEfforts[0]?.value
    ?? null
  const currentCodexReasoningEffortLabel = currentCodexReasoningEffort
    ? formatReasoningEffortLabel(currentCodexReasoningEffort)
    : null

  useEffect(() => {
    if (activeProvider !== 'codex') return
    if (codexModelsLoading || codexModels.length > 0) return
    void refreshCodexModels()
  }, [activeProvider, codexModelsLoading, codexModels.length, refreshCodexModels])

  if (activeProvider === 'claude') {
    return (
      <div className="flex items-center gap-1">
        {fastModeState && fastModeState !== 'off' && (
          <span title={t('tooltips.fastMode', { state: fastModeState })}>
            <Zap className={`size-3 ${fastModeState === 'on' ? 'text-yellow-500' : 'text-muted-foreground'}`} />
          </span>
        )}
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {currentModelName ? (
                <span className="max-w-[140px] truncate">{currentModelName}</span>
              ) : (
                <Loader2 className="size-3 animate-spin" />
              )}
              <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-64 max-h-60 overflow-y-auto border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
            <ClaudeModelList
              title={t('tooltips.selectModel')}
              models={availableModels}
              activeId={selectedModel ?? ''}
              onSelect={(id) => { setSelectedModel(id); setModelOpen(false) }}
              modelEnv={activeModelEnv}
            />
          </PopoverContent>
        </Popover>

        {activeModelEnv ? (
          forcedEffortLabel && (
            <span
              title={t('tooltips.effortFromEnv')}
              className="flex cursor-default items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground"
            >
              <span className="max-w-[100px] truncate">{forcedEffortLabel}</span>
            </span>
          )
        ) : (
          effortLevels && effortLevels.length > 0 && (
            <Popover open={effortOpen} onOpenChange={setEffortOpen}>
              <PopoverTrigger asChild>
                <button className={`flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground ${selectedEffort === 'high' || selectedEffort === 'max' ? '' : 'text-muted-foreground'}`}>
                  {selectedEffort === 'max' ? <FireText>MAX</FireText> : <span className={`max-w-[100px] truncate ${selectedEffort === 'high' ? 'rainbow-text font-normal' : ''}`}>{selectedEffort === 'high' ? 'ULTRATHINK' : (currentEffortLabel ?? 'Effort')}</span>}
                  <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" className="w-48 border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
                <EffortList
                  title={t('tooltips.thinkingEffort')}
                  levels={effortLevels}
                  labels={EFFORT_LABELS}
                  activeLevel={selectedEffort ?? ''}
                  onSelect={(level) => { setSelectedEffort(level); setEffortOpen(false) }}
                />
              </PopoverContent>
            </Popover>
          )
        )}

      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={modelOpen}
        onOpenChange={(open) => { setModelOpen(open); if (open) void refreshCodexModels() }}
      >
        <PopoverTrigger asChild>
          <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {currentCodexModelName ? (
              <span className="max-w-[140px] truncate">{currentCodexModelName}</span>
            ) : codexModelsLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span>{t('chat.codex.modelFallback')}</span>
            )}
            <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
          <CodexModelList
            title="Select Model"
            models={codexModels}
            activeId={selectedCodexModel ?? ''}
            onSelect={(id) => { setSelectedCodexModel(id); setModelOpen(false) }}
            loading={codexModelsLoading}
          />
        </PopoverContent>
      </Popover>

      {codexReasoningEfforts.length > 0 && (
        <Popover open={effortOpen} onOpenChange={setEffortOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <span className="max-w-[120px] truncate">
                {currentCodexReasoningEffortLabel ?? formatReasoningEffortLabel(codexReasoningEfforts[0].value)}
              </span>
              <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1" onCloseAutoFocus={onCloseAutoFocus}>
            <CodexReasoningEffortList
              title={t('tooltips.reasoningEffort')}
              options={codexReasoningEfforts}
              activeValue={currentCodexReasoningEffort ?? ''}
              onSelect={(value) => { setSelectedCodexReasoningEffort(value); setEffortOpen(false) }}
            />
          </PopoverContent>
        </Popover>
      )}

      {activeProvider === 'codex' && <CodexModeSelector />}
    </div>
  )
}
