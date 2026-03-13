import { useState, useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, Loader2, Check } from 'lucide-react'
import { formatCodexModelLabel, formatReasoningEffortLabel } from './chat-input-utils'
import { CodexModeSelector } from './CodexModeSelector'
import type { EffortLevel } from '../../../../shared/agent-types'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

export function ModelSelector() {
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

  const account = useChatStore((s) => s.account)
  const isApiUser = !!account.apiKeySource

  const currentModel = availableModels.find((m) => m.id === selectedModel)
  const currentModelName = (currentModel?.name ?? selectedModel) || null
  const effortLevels = currentModel?.supportedEffortLevels?.filter((l) => isApiUser || l !== 'max')
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
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {currentModelName ? (
                <span className="max-w-[140px] truncate">{currentModelName}</span>
              ) : (
                <Loader2 className="size-3 animate-spin" />
              )}
              <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-64 max-h-60 overflow-y-auto border-border bg-card p-1">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Select Model</div>
            {availableModels.map((model) => (
              <button
                key={model.id}
                onClick={() => { setSelectedModel(model.id); setModelOpen(false) }}
                className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  model.id === selectedModel ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
                }`}
              >
                <div className="font-medium">{model.name}</div>
                {model.description && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">{model.description}</div>
                )}
              </button>
            ))}
            {availableModels.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading models...</div>
            )}
          </PopoverContent>
        </Popover>

        {effortLevels && effortLevels.length > 0 && (
          <Popover open={effortOpen} onOpenChange={setEffortOpen}>
            <PopoverTrigger asChild>
              <button className={`flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground ${selectedEffort === 'high' ? '' : 'text-muted-foreground'}`}>
                <span className={`max-w-[100px] truncate ${selectedEffort === 'high' ? 'rainbow-text font-normal' : ''}`}>{selectedEffort === 'high' ? 'ULTRATHINK' : (currentEffortLabel ?? 'Effort')}</span>
                <ChevronDown className={`size-3 transition-transform duration-200 ${effortOpen ? 'rotate-180' : ''}`} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-48 border-border bg-card p-1">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Thinking Effort</div>
              {effortLevels.map((level) => (
                <button
                  key={level}
                  onClick={() => { setSelectedEffort(level); setEffortOpen(false) }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    level === selectedEffort ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <div className="font-medium">{EFFORT_LABELS[level]}</div>
                  {level === selectedEffort && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
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
              <span>Codex model</span>
            )}
            <ChevronDown className={`size-3 transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Select Model</div>
          {codexModels.map((model) => (
            <button
              key={model.id}
              onClick={() => { setSelectedCodexModel(model.id); setModelOpen(false) }}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                model.id === selectedCodexModel ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
              }`}
            >
              <div className="font-medium">{formatCodexModelLabel(model.id || model.name)}</div>
              {model.id === selectedCodexModel && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
          {codexModelsLoading && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading Codex models...</div>
          )}
          {!codexModelsLoading && codexModels.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Use default model (auto)</div>
          )}
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
          <PopoverContent align="start" side="top" className="w-72 max-h-60 overflow-y-auto border-border bg-card p-1">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Reasoning Effort</div>
            {codexReasoningEfforts.map((option) => (
              <button
                key={option.value}
                onClick={() => { setSelectedCodexReasoningEffort(option.value); setEffortOpen(false) }}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  option.value === currentCodexReasoningEffort ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
                }`}
              >
                <div className="font-medium">{formatReasoningEffortLabel(option.value)}</div>
                {option.value === currentCodexReasoningEffort && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {activeProvider === 'codex' && <CodexModeSelector />}
    </div>
  )
}
