import { useCallback } from 'react'
import { Terminal as TerminalIcon, Smartphone, Laptop, Bot } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TerminalListItem } from '@superone/shared/agent-types'
import { HoverCloseSlot } from '@/components/activity/ActivityTab'
import { terminalHolder } from './terminal-holder'

export const TERMINAL_HEADER_ITEM = 'flex items-center rounded-lg px-1.5 py-1 transition-colors'

function TerminalTabIcon({ tab }: { tab: TerminalListItem }) {
  const holder = terminalHolder(tab.ownerDeviceId)
  if (holder === 'phone') return <Smartphone className="size-3 shrink-0" />
  if (holder !== 'me') return <Laptop className="size-3 shrink-0" />
  return tab.agentControl ? <Bot className="size-3 shrink-0" /> : <TerminalIcon className="size-3 shrink-0" />
}

function SortableTerminalTab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: TerminalListItem
  active: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.terminalId,
  })
  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      className={`${TERMINAL_HEADER_ITEM} gap-1.5 shrink-0 cursor-pointer ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
      } ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <HoverCloseSlot onClose={onClose}>
        <TerminalTabIcon tab={tab} />
      </HoverCloseSlot>
      <span className="max-w-40 truncate text-xs">{tab.title}</span>
    </div>
  )
}

/** The terminal panel's tabs, reorderable by drag; a tab's icon tells who writes in it. */
export function TerminalTabStrip({ tabs, activeId, onActivate, onClose, onReorder }: {
  tabs: TerminalListItem[]
  activeId: string | null
  onActivate: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onReorder: (fromId: string, toId: string) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      onReorder(active.id as string, over.id as string)
    },
    [onReorder],
  )
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabs.map((t) => t.terminalId)} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab) => (
          <SortableTerminalTab
            key={tab.terminalId}
            tab={tab}
            active={tab.terminalId === activeId}
            onActivate={() => onActivate(tab.terminalId)}
            onClose={() => onClose(tab.terminalId)}
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}
