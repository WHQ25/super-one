import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
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

interface GroupedModelEffortSelectorProps {
  models?: SelectorModelOption[]
  modelGroups?: SelectorModelGroup[]
  selectedModelId: string | null
  selectedModelLabel?: string | null
  onSelectModel: (id: string) => void
  effortOptions: SelectorEffortOption[]
  selectedEffort: string | null
  selectedEffortLabel?: string | null
  onSelectEffort: (value: string) => void
  providers?: SelectorProviderOption[]
  selectedProviderId?: string | null
  onSelectProvider?: (id: string | null) => void
  onManageProviders?: () => void
  triggerLabel?: ReactNode
  onCloseAutoFocus?: (event: Event) => void
  className?: string
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: SelectorModelOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault()
        onSelect()
      }}
      className={cn('items-center gap-2 px-2 py-1.5', ITEM_FOCUS, selected && 'bg-muted')}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-tight">{model.name}</div>
        {model.description && (
          <div className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{model.description}</div>
        )}
      </div>
      {selected && <Check className="mt-0.5 size-3.5 shrink-0 self-start text-primary" />}
    </DropdownMenuItem>
  )
}

function ModelList({
  models,
  modelGroups,
  selectedModelId,
  onSelectModel,
}: Pick<GroupedModelEffortSelectorProps, 'models' | 'modelGroups' | 'selectedModelId' | 'onSelectModel'>) {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const hasGroups = Boolean(modelGroups?.length)

  return (
    <div className="max-h-60 min-h-0 shrink overflow-y-auto pr-1">
        {hasGroups
          ? modelGroups!.map((group) => {
              const expanded = expandedGroupIds.has(group.id)
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
                onSelect={() => onSelectModel(model.id)}
              />
            ))}
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
        <div className="mt-2 text-[10px] leading-tight text-muted-foreground">{selectedOption.description}</div>
      )}
    </div>
  )
}

export function GroupedModelEffortSelector({
  models,
  modelGroups,
  selectedModelId,
  selectedModelLabel,
  onSelectModel,
  effortOptions,
  selectedEffort,
  selectedEffortLabel,
  onSelectEffort,
  providers = [],
  selectedProviderId,
  onSelectProvider,
  onManageProviders,
  triggerLabel,
  onCloseAutoFocus,
  className,
}: GroupedModelEffortSelectorProps) {
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const selectedModel = useMemo(() => {
    const allModels = modelGroups?.flatMap((group) => group.models) ?? models ?? []
    return allModels.find((model) => model.id === selectedModelId)
  }, [modelGroups, models, selectedModelId])
  const selectedEffortOption = effortOptions.find((option) => option.value === selectedEffort)
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const modelLabel = selectedModelLabel ?? selectedModel?.name ?? selectedModelId ?? 'Model'
  const effortLabel = selectedEffortLabel ?? selectedEffortOption?.label ?? 'Effort'

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setModelsExpanded(false) }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn('group flex max-w-64 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', className)}
        >
          {triggerLabel ? (
            <span className="min-w-0">{triggerLabel}</span>
          ) : (
            <>
              <span className="truncate">{modelLabel}</span>
              {effortOptions.length > 0 && (
                <>
                  <span className="text-muted-foreground/70">·</span>
                  <span className="shrink-0">{effortLabel}</span>
                </>
              )}
            </>
          )}
          <ChevronDown className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-[70vh] w-72 overflow-hidden p-1" onCloseAutoFocus={onCloseAutoFocus}>
        <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Models</div>

        <AnimatePresence initial={false}>
          {modelsExpanded ? (
            <motion.div key="model-list" {...MORPH} className="overflow-hidden">
              <ModelList
                models={models}
                modelGroups={modelGroups}
                selectedModelId={selectedModelId}
                onSelectModel={(id) => {
                  onSelectModel(id)
                  setModelsExpanded(false)
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="model-row" {...MORPH} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setModelsExpanded(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium leading-tight">{modelLabel}</div>
                  {selectedModel?.description && (
                    <div className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{selectedModel.description}</div>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {modelsExpanded ? (
            providers.length > 0 && onSelectProvider ? (
              <motion.div key="provider" {...MORPH} className="overflow-hidden">
                <DropdownMenuSeparator />
                <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Provider</div>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={cn('items-center gap-1.5 px-2 py-1.5', ITEM_FOCUS, 'data-[state=open]:bg-muted data-[state=open]:text-foreground')}>
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
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-64">
                    {providers.map((provider) => {
                      const selected = provider.id === selectedProviderId
                      return (
                        <DropdownMenuItem
                          key={provider.id ?? '__default__'}
                          onSelect={() => onSelectProvider(provider.id)}
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
                    {onManageProviders && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onManageProviders} className={cn('gap-2 px-2 py-1.5 text-sm text-muted-foreground', ITEM_FOCUS)}>
                          <Settings2 className="size-4 shrink-0" />
                          <span>Provider settings</span>
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </motion.div>
            ) : null
          ) : (
            effortOptions.length > 0 ? (
              <motion.div key="effort" {...MORPH} className="overflow-hidden">
                <DropdownMenuSeparator />
                <EffortSlider
                  effortOptions={effortOptions}
                  selectedEffort={selectedEffort}
                  selectedEffortLabel={selectedEffortLabel}
                  onSelectEffort={onSelectEffort}
                />
              </motion.div>
            ) : null
          )}
        </AnimatePresence>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
