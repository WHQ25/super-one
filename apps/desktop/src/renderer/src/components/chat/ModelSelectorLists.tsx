import { Check, Loader2 } from 'lucide-react'
import type { CodexReasoningEffort, EffortLevel, ModelBucket, ModelOption, ProviderModelEnv, ReasoningEffortOption } from '@superone/shared/agent-types'
import { formatCodexModelLabel, formatReasoningEffortLabel } from './chat-input-utils'

function claudeIdToBucket(id: string): ModelBucket {
  const lower = id.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return 'default'
}

interface ClearOption {
  label: string
  isActive: boolean
  onSelect: () => void
}

interface ListHeaderProps {
  title?: string
  clearOption?: ClearOption
}

function ListHeader({ title, clearOption }: ListHeaderProps) {
  return (
    <>
      {title && <div className="px-2 py-1.5 text-xs text-muted-foreground">{title}</div>}
      {clearOption && (
        <>
          <button
            onClick={clearOption.onSelect}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
              clearOption.isActive ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <span className="font-medium">{clearOption.label}</span>
            {clearOption.isActive && <Check className="size-3.5 shrink-0 text-primary" />}
          </button>
          <div className="my-1 border-t border-border/60" />
        </>
      )}
    </>
  )
}

interface ClaudeModelListProps {
  models: ModelOption[]
  activeId: string
  onSelect: (id: string) => void
  title?: string
  clearOption?: ClearOption
  loadingMessage?: string
  emptyMessage?: string
  modelEnv?: ProviderModelEnv | null
}

interface ResolvedEntry {
  model: ModelOption
  displayName: string
  description?: string
}

export function resolveClaudeEntries(models: ModelOption[], modelEnv: ProviderModelEnv | null | undefined): ResolvedEntry[] {
  const entries: ResolvedEntry[] = []
  const seenSlotIds = new Set<string>()
  for (const model of models) {
    if (!modelEnv) {
      entries.push({ model, displayName: model.name, description: model.description })
      continue
    }
    const bucket = claudeIdToBucket(model.id)
    const slot = modelEnv[bucket]
    if (!slot?.id) {
      entries.push({ model, displayName: model.name, description: undefined })
      continue
    }
    if (seenSlotIds.has(slot.id)) continue
    seenSlotIds.add(slot.id)
    entries.push({
      model,
      displayName: slot.name ?? slot.id,
      description: slot.description,
    })
  }
  return entries
}

export function ClaudeModelList({
  models,
  activeId,
  onSelect,
  title,
  clearOption,
  loadingMessage = 'Loading models...',
  emptyMessage,
  modelEnv,
}: ClaudeModelListProps) {
  const entries = resolveClaudeEntries(models, modelEnv)
  return (
    <>
      <ListHeader title={title} clearOption={clearOption} />
      {entries.map(({ model, displayName, description }) => {
        const active = model.id === activeId
        return (
          <button
            key={model.id}
            onClick={() => onSelect(model.id)}
            className={`flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
              active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{displayName}</div>
              {description && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>
              )}
            </div>
            {active && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
          </button>
        )
      })}
      {entries.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyMessage ?? loadingMessage}</div>
      )}
    </>
  )
}

export function resolveClaudeDisplayName(model: ModelOption | undefined, modelEnv: ProviderModelEnv | null | undefined): string | null {
  if (!model) return null
  if (!modelEnv) return model.name ?? model.id
  const slot = modelEnv[claudeIdToBucket(model.id)]
  return slot?.name ?? slot?.id ?? model.name ?? model.id
}

interface EffortListProps {
  levels: EffortLevel[]
  labels: Record<EffortLevel, string>
  activeLevel: EffortLevel | ''
  onSelect: (level: EffortLevel) => void
  title?: string
  clearOption?: ClearOption
  emptyMessage?: string
}

export function EffortList({
  levels,
  labels,
  activeLevel,
  onSelect,
  title,
  clearOption,
  emptyMessage,
}: EffortListProps) {
  return (
    <>
      <ListHeader title={title} clearOption={clearOption} />
      {levels.map((level) => {
        const active = level === activeLevel
        return (
          <button
            key={level}
            onClick={() => onSelect(level)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
              active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <div className="font-medium">{labels[level]}</div>
            {active && <Check className="size-3.5 shrink-0 text-primary" />}
          </button>
        )
      })}
      {levels.length === 0 && emptyMessage && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyMessage}</div>
      )}
    </>
  )
}

interface CodexModelListProps {
  models: ModelOption[]
  activeId: string
  onSelect: (id: string) => void
  title?: string
  clearOption?: ClearOption
  loading?: boolean
  loadingMessage?: string
  emptyMessage?: string
}

export function CodexModelList({
  models,
  activeId,
  onSelect,
  title,
  clearOption,
  loading = false,
  loadingMessage = 'Loading Codex models...',
  emptyMessage = 'Use default model (auto)',
}: CodexModelListProps) {
  return (
    <>
      <ListHeader title={title} clearOption={clearOption} />
      {models.map((model) => {
        const active = model.id === activeId
        return (
          <button
            key={model.id}
            onClick={() => onSelect(model.id)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
              active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <div className="font-medium">{formatCodexModelLabel(model.id || model.name)}</div>
            {active && <Check className="size-3.5 shrink-0 text-primary" />}
          </button>
        )
      })}
      {loading && models.length === 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {loadingMessage}
        </div>
      )}
      {!loading && models.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyMessage}</div>
      )}
    </>
  )
}

interface CodexReasoningEffortListProps {
  options: ReasoningEffortOption[]
  activeValue: CodexReasoningEffort | ''
  onSelect: (value: CodexReasoningEffort) => void
  title?: string
  clearOption?: ClearOption
  emptyMessage?: string
}

export function CodexReasoningEffortList({
  options,
  activeValue,
  onSelect,
  title,
  clearOption,
  emptyMessage,
}: CodexReasoningEffortListProps) {
  return (
    <>
      <ListHeader title={title} clearOption={clearOption} />
      {options.map((option) => {
        const active = option.value === activeValue
        return (
          <button
            key={option.value}
            onClick={() => onSelect(option.value)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
              active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
            }`}
          >
            <div className="font-medium">{formatReasoningEffortLabel(option.value)}</div>
            {active && <Check className="size-3.5 shrink-0 text-primary" />}
          </button>
        )
      })}
      {options.length === 0 && emptyMessage && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyMessage}</div>
      )}
    </>
  )
}
