import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, ChevronRight, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { Command, CommandInput } from '@superone/ui/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { ProviderOptionLabel } from '@/components/providers/DefaultProviderRow'

export interface SelectorModelOption {
  id: string
  name: string
  description?: string
}

export interface SelectorModelGroup {
  id: string
  name: string
  models: SelectorModelOption[]
}

export interface SelectorEffortOption {
  value: string
  label: string
  description?: string
}

export interface SelectorProviderOption {
  id: string | null
  name: string
  brand?: string | null
  keyName?: string
  description?: string
}

export interface SelectorAgentOption {
  id: string
  name: string
  description?: string
}

interface GroupedModelEffortSelectorProps {
  models?: SelectorModelOption[]
  modelGroups?: SelectorModelGroup[]
  selectedModelId: string | null
  selectedModelLabel?: string | null
  onSelectModel: (id: string) => void
  shouldCloseAfterModelSelect?: (id: string) => boolean
  effortOptions: SelectorEffortOption[]
  selectedEffort: string | null
  selectedEffortLabel?: string | null
  onSelectEffort: (value: string) => void
  /** Optional primary-agent list (e.g. OpenCode build/plan/general). */
  agents?: SelectorAgentOption[]
  selectedAgentId?: string | null
  selectedAgentLabel?: string | null
  onSelectAgent?: (id: string) => void
  /** Disable agent picking (e.g. OpenCode plan permission forces the plan agent). */
  agentsDisabled?: boolean
  providers?: SelectorProviderOption[]
  selectedProviderId?: string | null
  onSelectProvider?: (id: string | null) => void
  onManageProviders?: () => void
  onRefreshModels?: () => void
  modelsLoading?: boolean
  triggerLabel?: ReactNode
  onCloseAutoFocus?: (event: Event) => void
  className?: string
}

function ModelRow({
  model,
  selected,
  keepOpen,
  onSelect,
}: {
  model: SelectorModelOption
  selected: boolean
  keepOpen: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        if (keepOpen) event.preventDefault()
        onSelect()
      }}
      className={cn('items-center gap-2 px-2 py-1.5', ITEM_FOCUS, selected && 'bg-muted')}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-tight">{model.name}</div>
        {model.description && (
          <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">{model.description}</div>
        )}
      </div>
      {selected && <Check className="mt-0.5 size-3.5 shrink-0 self-start text-primary" />}
    </DropdownMenuItem>
  )
}

function RefreshModelsButton({
  onRefreshModels,
  modelsLoading,
}: Pick<GroupedModelEffortSelectorProps, 'onRefreshModels' | 'modelsLoading'>) {
  if (!onRefreshModels) return null
  return (
    <IconButton
      size="xs"
      variant="nested"
      tooltip="Refresh models"
      disabled={modelsLoading}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onRefreshModels()
      }}
    >
      <RefreshCw className={cn(modelsLoading && 'animate-spin')} />
    </IconButton>
  )
}

function ModelList({
  models,
  modelGroups,
  selectedModelId,
  shouldKeepOpen,
  onSelectModel,
  searchActive,
  emptyMessage,
}: Pick<GroupedModelEffortSelectorProps, 'models' | 'modelGroups' | 'selectedModelId' | 'onSelectModel'> & {
  shouldKeepOpen: (model: SelectorModelOption) => boolean
  searchActive: boolean
  emptyMessage: string
}) {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const hasGroups = modelGroups !== undefined
  const hasModels = hasGroups
    ? modelGroups!.some((group) => group.models.length > 0)
    : (models?.length ?? 0) > 0

  return (
    <div className="max-h-60 min-h-0 shrink overflow-y-auto pr-1">
        {hasGroups
          ? modelGroups!.map((group) => {
              const expanded = searchActive || expandedGroupIds.has(group.id)
              const hasSelectedModel = group.models.some((model) => model.id === selectedModelId)
              return (
                <div key={group.id}>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault()
                      setExpandedGroupIds((ids) => {
                        const next = new Set(ids)
                        if (next.has(group.id)) next.delete(group.id)
                        else next.add(group.id)
                        return next
                      })
                    }}
                    className={cn('min-h-7 gap-1.5 px-2 py-1 text-xs', ITEM_FOCUS, hasSelectedModel && 'bg-muted/60')}
                  >
                    <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
                    <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                    {hasSelectedModel && <Check className="size-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                  {expanded && (
                    <div className="ml-2 border-l border-border pl-1">
                      {group.models.map((model) => (
                        <ModelRow
                          key={model.id}
                          model={model}
                          selected={model.id === selectedModelId}
                          keepOpen={shouldKeepOpen(model)}
                          onSelect={() => onSelectModel(model.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          : models?.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={model.id === selectedModelId}
                keepOpen={shouldKeepOpen(model)}
                onSelect={() => onSelectModel(model.id)}
              />
            ))}
        {!hasModels && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{emptyMessage}</div>
        )}
    </div>
  )
}

const THUMB_PX = 28
const STOP_INSET_PX = THUMB_PX / 2
const ITEM_FOCUS = 'focus:bg-muted focus:text-foreground'
const MORPH = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] },
} as const

function EffortSlider({
  effortOptions,
  selectedEffort,
  selectedEffortLabel,
  onSelectEffort,
}: Pick<GroupedModelEffortSelectorProps, 'effortOptions' | 'selectedEffort' | 'selectedEffortLabel' | 'onSelectEffort'>) {
  const selectedIndex = Math.max(0, effortOptions.findIndex((option) => option.value === selectedEffort))
  const selectedOption = effortOptions[selectedIndex]
  const selectedLabel = selectedEffortLabel ?? selectedOption?.label ?? 'Effort'
  const lastIndex = effortOptions.length - 1

  if (effortOptions.length === 0) return null

  const stopAt = (index: number) =>
    lastIndex > 0 ? `calc(${index / lastIndex} * (100% - ${THUMB_PX}px) + ${STOP_INSET_PX}px)` : `${STOP_INSET_PX}px`
  const fillWidth = stopAt(selectedIndex)

  return (
    <div className="px-2 pb-2 pt-1.5">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Effort</span>
        <span className="font-medium text-primary">{selectedLabel}</span>
      </div>
      <div className="relative flex h-6 items-center">
        <div className="absolute inset-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: fillWidth }} />
        </div>
        {effortOptions.map((option, index) => (
          <span
            key={option.value}
            className={cn(
              'pointer-events-none absolute size-1.5 -translate-x-1/2 rounded-full',
              index < selectedIndex ? 'bg-primary-foreground/50' : 'bg-muted-foreground/40',
            )}
            style={{ left: stopAt(index) }}
            aria-hidden="true"
          />
        ))}
        <input
          type="range"
          min={0}
          max={lastIndex}
          step={1}
          value={selectedIndex}
          aria-label="Effort"
          className="group/effort relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/10 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-[width,height] [&::-moz-range-track]:h-6 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-6 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-0.5 [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/10 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-[width,height,margin] hover:[&::-moz-range-thumb]:size-8 hover:[&::-webkit-slider-thumb]:-mt-1 hover:[&::-webkit-slider-thumb]:size-8"
          onChange={(event) => onSelectEffort(effortOptions[Number(event.currentTarget.value)]!.value)}
        />
      </div>
      {selectedOption?.description && (
        <div className="mt-2 text-xs leading-tight text-muted-foreground">{selectedOption.description}</div>
      )}
    </div>
  )
}

export function hasSelectableEffort(effortOptions: SelectorEffortOption[]): boolean {
  return effortOptions.length > 1
}

export function matchesModelSearch(model: SelectorModelOption, query: string): boolean {
  return [model.id, model.name, model.description]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query))
}

export function GroupedModelEffortSelector({
  models,
  modelGroups,
  selectedModelId,
  selectedModelLabel,
  onSelectModel,
  shouldCloseAfterModelSelect,
  effortOptions,
  selectedEffort,
  selectedEffortLabel,
  onSelectEffort,
  agents = [],
  selectedAgentId,
  selectedAgentLabel,
  onSelectAgent,
  agentsDisabled = false,
  providers = [],
  selectedProviderId,
  onSelectProvider,
  onManageProviders,
  onRefreshModels,
  modelsLoading,
  triggerLabel,
  onCloseAutoFocus,
  className,
}: GroupedModelEffortSelectorProps) {
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const [agentsExpanded, setAgentsExpanded] = useState(false)
  const [providersExpanded, setProvidersExpanded] = useState(false)
  const [modelSearchOpen, setModelSearchOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const collapseAll = () => {
    setModelsExpanded(false)
    setAgentsExpanded(false)
    setProvidersExpanded(false)
    setModelSearchOpen(false)
    setModelSearch('')
  }
  const allModels = useMemo(
    () => modelGroups?.flatMap((group) => group.models) ?? models ?? [],
    [modelGroups, models],
  )
  const selectedModel = useMemo(
    () => allModels.find((model) => model.id === selectedModelId),
    [allModels, selectedModelId],
  )
  const selectedEffortOption = effortOptions.find((option) => option.value === selectedEffort)
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)
  const agentLabel = selectedAgentLabel ?? selectedAgent?.name ?? selectedAgentId ?? 'Agent'
  const modelLabel = selectedModelLabel ?? selectedModel?.name ?? selectedModelId ?? 'Model'
  const effortLabel = selectedEffortLabel ?? selectedEffortOption?.label ?? 'Effort'
  const canSelectEffort = hasSelectableEffort(effortOptions)
  const hasAgents = agents.length > 0 && Boolean(onSelectAgent)
  const shouldCloseAfterSelect = (modelId: string): boolean =>
    shouldCloseAfterModelSelect?.(modelId) ?? !canSelectEffort
  const listOpen = modelsExpanded || !canSelectEffort
  const modelSearchAvailable = listOpen && allModels.length > 10
  const normalizedModelSearch = modelSearch.trim().toLowerCase()
  const filteredModels = useMemo(
    () => !normalizedModelSearch ? models : models?.filter((model) => matchesModelSearch(model, normalizedModelSearch)),
    [models, normalizedModelSearch],
  )
  const filteredModelGroups = useMemo(
    () => !normalizedModelSearch
      ? modelGroups
      : modelGroups
          ?.map((group) => ({ ...group, models: group.models.filter((model) => matchesModelSearch(model, normalizedModelSearch)) }))
          .filter((group) => group.models.length > 0),
    [modelGroups, normalizedModelSearch],
  )

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) collapseAll() }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={
            triggerLabel
              ? undefined
              : [hasAgents ? agentLabel : null, modelLabel, canSelectEffort ? effortLabel : null]
                  .filter(Boolean)
                  .join(' · ')
          }
          className={cn(
            // Prefer showing the full label when space allows; parent flex can still constrain.
            'group flex min-w-0 max-w-xl items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            className,
          )}
        >
          {triggerLabel ? (
            <span className="min-w-0 truncate">{triggerLabel}</span>
          ) : (
            // Truncation priority via flex-shrink: model last, agent middle, effort first.
            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
              {hasAgents && (
                <>
                  <span className="min-w-0 shrink-[8] truncate">{agentLabel}</span>
                  <span className="shrink-0 text-muted-foreground/70">·</span>
                </>
              )}
              <span className="min-w-0 shrink truncate">{modelLabel}</span>
              {canSelectEffort && (
                <>
                  <span className="shrink-0 text-muted-foreground/70">·</span>
                  <span className="min-w-0 shrink-[64] truncate">{effortLabel}</span>
                </>
              )}
            </span>
          )}
          <ChevronDown className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-[70vh] w-72 overflow-hidden p-1" onCloseAutoFocus={onCloseAutoFocus}>
        {hasAgents && (
          <>
            <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Agent</div>
            <AnimatePresence initial={false}>
              {agentsExpanded && !agentsDisabled ? (
                <motion.div key="agent-list" {...MORPH} className="overflow-hidden">
                  <div className="max-h-48 min-h-0 overflow-y-auto pr-1">
                    {agents.map((agent) => {
                      const selected = agent.id === selectedAgentId
                      return (
                        <DropdownMenuItem
                          key={agent.id}
                          onSelect={(event) => {
                            event.preventDefault()
                            onSelectAgent?.(agent.id)
                            setAgentsExpanded(false)
                          }}
                          className={cn('items-start gap-2 px-2 py-1.5', ITEM_FOCUS, selected && 'bg-muted')}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium leading-tight">{agent.name}</div>
                            {agent.description && (
                              <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                                {agent.description}
                              </div>
                            )}
                          </div>
                          {selected && <Check className="mt-0.5 size-3.5 shrink-0 self-start text-primary" />}
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="agent-row" {...MORPH} className="overflow-hidden">
                  <button
                    type="button"
                    disabled={agentsDisabled}
                    title={agentsDisabled ? 'Plan mode uses the plan agent' : undefined}
                    onClick={() => {
                      if (agentsDisabled) return
                      setModelsExpanded(false)
                      setProvidersExpanded(false)
                      setAgentsExpanded(true)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none',
                      agentsDisabled
                        ? 'cursor-default opacity-60'
                        : 'hover:bg-muted focus:bg-muted',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium leading-tight">{agentLabel}</div>
                      {selectedAgent?.description && !agentsDisabled && (
                        <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                          {selectedAgent.description}
                        </div>
                      )}
                      {agentsDisabled && (
                        <div className="text-xs leading-tight text-muted-foreground">
                          Forced by plan mode
                        </div>
                      )}
                    </div>
                    {!agentsDisabled && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <DropdownMenuSeparator />
          </>
        )}

        {modelSearchAvailable && modelSearchOpen ? (
          <div className="flex items-center gap-1 border-b">
            <Command shouldFilter={false} className="min-w-0 flex-1 rounded-none [&_[data-slot=command-input-wrapper]]:border-b-0">
              <CommandInput
                autoFocus
                placeholder="Search models..."
                value={modelSearch}
                onValueChange={setModelSearch}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </Command>
            <IconButton
              size="xs"
              variant="nested"
              tooltip="Close search"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setModelSearch('')
                setModelSearchOpen(false)
              }}
            >
              <X />
            </IconButton>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
            <span className="text-xs text-muted-foreground">Models</span>
            <div className="flex items-center gap-1">
              <RefreshModelsButton onRefreshModels={onRefreshModels} modelsLoading={modelsLoading} />
              {modelSearchAvailable && (
                <IconButton
                  size="xs"
                  variant="nested"
                  tooltip="Search models"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setModelSearchOpen(true)
                  }}
                >
                  <Search />
                </IconButton>
              )}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {listOpen ? (
            <motion.div key="model-list" {...MORPH} className="overflow-hidden">
              <ModelList
                models={filteredModels}
                modelGroups={filteredModelGroups}
                selectedModelId={selectedModelId}
                shouldKeepOpen={(model) => !shouldCloseAfterSelect(model.id)}
                searchActive={Boolean(normalizedModelSearch)}
                emptyMessage={normalizedModelSearch ? 'No models found' : 'No models'}
                onSelectModel={(id) => {
                  onSelectModel(id)
                  if (!shouldCloseAfterSelect(id)) collapseAll()
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="model-row" {...MORPH} className="overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setAgentsExpanded(false)
                  setProvidersExpanded(false)
                  setModelsExpanded(true)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium leading-tight">{modelLabel}</div>
                  {selectedModel?.description && (
                    <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">{selectedModel.description}</div>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {!modelsExpanded && !agentsExpanded && canSelectEffort && (
            <motion.div key="effort" {...MORPH} className="overflow-hidden">
              <DropdownMenuSeparator />
              <EffortSlider
                effortOptions={effortOptions}
                selectedEffort={selectedEffort}
                selectedEffortLabel={selectedEffortLabel}
                onSelectEffort={onSelectEffort}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {listOpen && providers.length > 0 && onSelectProvider && (
            <motion.div key="provider-header" {...MORPH} className="overflow-hidden">
              <DropdownMenuSeparator />
              <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Provider</div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {listOpen && providers.length > 0 && onSelectProvider && (
            providersExpanded ? (
              <motion.div key="provider-list" {...MORPH} className="overflow-hidden">
                <div className="max-h-60 min-h-0 overflow-y-auto pr-1">
                  {providers.map((provider) => {
                    const selected = provider.id === selectedProviderId
                    return (
                      <DropdownMenuItem
                        key={provider.id ?? '__default__'}
                        onSelect={(event) => {
                          event.preventDefault()
                          onSelectProvider(provider.id)
                          setProvidersExpanded(false)
                        }}
                        className={cn('justify-between gap-2 px-2 py-1.5', ITEM_FOCUS, selected && 'bg-muted')}
                      >
                        <ProviderOptionLabel brandKey={provider.brand ?? ''} name={provider.name} />
                        <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                          {provider.keyName && <span className="truncate text-xs text-muted-foreground">{provider.keyName}</span>}
                          {selected && <Check className="size-4 shrink-0 text-primary" />}
                        </span>
                      </DropdownMenuItem>
                    )
                  })}
                </div>
                {onManageProviders && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onManageProviders} className={cn('gap-2 px-2 py-1.5 text-sm text-muted-foreground', ITEM_FOCUS)}>
                      <Settings2 className="size-4 shrink-0" />
                      <span>Provider settings</span>
                    </DropdownMenuItem>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="provider-row" {...MORPH} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setAgentsExpanded(false)
                    setProvidersExpanded(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
                >
                  {selectedProvider ? (
                    <>
                      <span className="flex min-w-0 flex-1 items-center">
                        <ProviderOptionLabel brandKey={selectedProvider.brand ?? ''} name={selectedProvider.name} />
                      </span>
                      {selectedProvider.keyName && (
                        <span className="truncate text-xs text-muted-foreground">{selectedProvider.keyName}</span>
                      )}
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">Default</span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </motion.div>
            )
          )}
        </AnimatePresence>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
