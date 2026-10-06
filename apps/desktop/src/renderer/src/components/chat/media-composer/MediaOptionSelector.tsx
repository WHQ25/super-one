import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MediaComposerModel } from '@superone/shared/media-composer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import {
  GroupedModelEffortSelector, ModelRow, SELECTOR_TRIGGER_CLASS, type SelectorCatalogParam,
} from '../model-selector/GroupedModelEffortSelector'

export interface MediaOption { value: string; label: string; description?: string; leading?: ReactNode }
export interface MediaOptionGroup { label: string; options: MediaOption[] }

const preventFocusReturn = (event: Event) => event.preventDefault()

/** A toolbar selector styled like the chat model selector; `children` replaces the option list. */
export function MediaOptionSelector({ title, label, leading, groups, value, onChange, children, className }: {
  title: string
  label: string
  leading?: ReactNode
  groups?: MediaOptionGroup[]
  value?: string
  onChange?: (value: string) => void
  children?: ReactNode
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={title} aria-label={`${title}: ${label}`} className={cn(SELECTOR_TRIGGER_CLASS, 'shrink-0', className)}>
          {leading}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60 p-1" onCloseAutoFocus={preventFocusReturn}>
        {children ?? groups?.map(group => (
          <div key={group.label} className="pb-1">
            <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">{group.label}</div>
            {group.options.map(option => (
              <ModelRow
                key={option.value}
                model={{ id: option.value, name: option.label, description: option.description }}
                leading={option.leading}
                selected={option.value === value}
                keepOpen={false}
                onSelect={() => onChange?.(option.value)}
              />
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const mediaModelKey = (model: Pick<MediaComposerModel, 'providerId' | 'model'>) => JSON.stringify([model.providerId, model.model])

/** The chat model selector, listing media models instead of harness models. */
export function MediaModelSelector({ models, selected, onSelect, onRefresh, loading, options, onOptionChange }: {
  models: MediaComposerModel[]
  selected?: MediaComposerModel
  onSelect: (model: MediaComposerModel) => void
  onRefresh?: () => void
  loading?: boolean
  options?: SelectorCatalogParam[]
  onOptionChange?: (id: string, value: string) => void
}) {
  return (
    <GroupedModelEffortSelector
      models={models.map(model => ({ id: mediaModelKey(model), name: model.label, description: model.providerLabel }))}
      selectedModelId={selected ? mediaModelKey(selected) : null}
      selectedModelLabel={selected?.label}
      onSelectModel={key => { const model = models.find(item => mediaModelKey(item) === key); if (model) onSelect(model) }}
      effortOptions={[]}
      selectedEffort={null}
      onSelectEffort={() => {}}
      onRefreshModels={onRefresh}
      modelsLoading={loading}
      optionParams={options}
      onOptionParamChange={onOptionChange}
      onCloseAutoFocus={preventFocusReturn}
      className="shrink-0"
    />
  )
}

/** Outline of the frame shape for an aspect ratio; `auto` draws a dashed square. */
export function RatioIcon({ ratio, size = 14 }: { ratio: string; size?: number }) {
  const [w, h] = /^\d+:\d+$/.test(ratio) ? ratio.split(':').map(Number) as [number, number] : [0, 0]
  const scale = w && h ? size / Math.max(w, h) : 0
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      <span
        className={cn('box-border rounded-[2px] border-[1.5px] border-current', !scale && 'border-dashed')}
        style={scale ? { width: w * scale, height: h * scale } : { width: size * 0.8, height: size * 0.8 }}
      />
    </span>
  )
}
