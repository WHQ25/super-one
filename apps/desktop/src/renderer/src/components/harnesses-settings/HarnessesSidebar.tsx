import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, Loader2, RefreshCw } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { SettingsNavGroup, SettingsNavItem } from '../settings/SettingsNav'
import type { ListItem } from './HarnessesSettingsParts'

export function HarnessListRow({
  item,
  selected,
  onSelect,
  dragHandle,
  isDragging,
  style,
  setNodeRef,
  attributes,
  listeners,
}: {
  item: ListItem
  selected: boolean
  onSelect: () => void
  dragHandle?: boolean
  isDragging?: boolean
  style?: CSSProperties
  setNodeRef?: (node: HTMLElement | null) => void
  attributes?: ReturnType<typeof useSortable>['attributes']
  listeners?: ReturnType<typeof useSortable>['listeners']
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const Icon = resolveSessionIcon(item.provider, acpAgentId)
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('group relative rounded-md', isDragging && 'z-10 bg-background opacity-80 shadow-sm')}
    >
      <SettingsNavItem
        size="lg"
        selected={selected}
        onClick={onSelect}
        className={cn(dragHandle && 'pr-7')}
        icon={Icon ? (
          <Icon status="default" size={30} renderLevel="compact" />
        ) : (
          <span className="size-[30px] shrink-0 rounded bg-muted" />
        )}
        trailing={item.experimental ? t('settings.harnesses.experimentalBadge') : undefined}
      >
        {item.label}
      </SettingsNavItem>
      {dragHandle ? (
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          aria-label={t('settings.harnesses.dragHandle')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function SortableHarnessRow({
  item,
  selected,
  disabled,
  onSelect,
}: {
  item: ListItem
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  })
  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition,
  }
  return (
    <HarnessListRow
      item={item}
      selected={selected}
      onSelect={onSelect}
      dragHandle
      isDragging={isDragging}
      style={style}
      setNodeRef={setNodeRef}
      attributes={attributes}
      listeners={listeners}
    />
  )
}

export function HarnessesSidebar({
  loading,
  hasCatalog,
  busyKey,
  savingOrder,
  selectedKey,
  enabledItems,
  disabledItems,
  enabledOrderIds,
  sensors,
  onRefresh,
  onSelectItem,
  onDragEnd,
}: {
  loading: boolean
  hasCatalog: boolean
  busyKey: string | null
  savingOrder: boolean
  selectedKey: string | null
  enabledItems: ListItem[]
  disabledItems: ListItem[]
  enabledOrderIds: string[]
  sensors: SensorDescriptor<SensorOptions>[]
  onRefresh: () => void
  onSelectItem: (item: ListItem) => void
  onDragEnd: (event: DragEndEvent) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border px-2.5 py-3">
      <div className="flex min-h-7 items-center justify-between gap-2 pl-2">
        <h2 className="text-lg font-semibold">{t('settings.harnesses.title')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 p-0 text-muted-foreground"
          aria-label={t('common.refresh')}
          onClick={onRefresh}
          disabled={loading || busyKey !== null}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {loading && !hasCatalog ? (
        <div className="flex items-center gap-2 px-2 pt-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('settings.harnesses.loading')}
        </div>
      ) : null}

      {enabledItems.length > 0 && (
        <SettingsNavGroup label={t('settings.harnesses.groupEnabled')}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={enabledOrderIds} strategy={verticalListSortingStrategy}>
              {enabledItems.map((item) => (
                <SortableHarnessRow
                  key={item.key}
                  item={item}
                  selected={selectedKey === item.key}
                  disabled={savingOrder || busyKey !== null}
                  onSelect={() => onSelectItem(item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </SettingsNavGroup>
      )}

      {disabledItems.length > 0 && (
        <SettingsNavGroup label={t('settings.harnesses.groupDisabled')}>
          {disabledItems.map((item) => (
            <HarnessListRow
              key={item.key}
              item={item}
              selected={selectedKey === item.key}
              onSelect={() => onSelectItem(item)}
            />
          ))}
        </SettingsNavGroup>
      )}
    </div>
  )
}
