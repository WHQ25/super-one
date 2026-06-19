import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface TableMenuPos {
  x: number
  y: number
}

interface TableContextMenuProps {
  editor: Editor
  pos: TableMenuPos
  onClose: () => void
}

export type TableMenuEntry =
  | { type: 'separator' }
  | { type: 'item'; label: string; icon: LucideIcon; destructive?: boolean; run: (editor: Editor) => void }

export const TABLE_MENU_ENTRIES: TableMenuEntry[] = [
  { type: 'item', label: 'Insert column left', icon: ArrowLeftToLine, run: (e) => e.chain().focus().addColumnBefore().run() },
  { type: 'item', label: 'Insert column right', icon: ArrowRightToLine, run: (e) => e.chain().focus().addColumnAfter().run() },
  { type: 'item', label: 'Delete column', icon: X, run: (e) => e.chain().focus().deleteColumn().run() },
  { type: 'separator' },
  { type: 'item', label: 'Insert row above', icon: ArrowUpToLine, run: (e) => e.chain().focus().addRowBefore().run() },
  { type: 'item', label: 'Insert row below', icon: ArrowDownToLine, run: (e) => e.chain().focus().addRowAfter().run() },
  { type: 'item', label: 'Delete row', icon: X, run: (e) => e.chain().focus().deleteRow().run() },
  { type: 'separator' },
  { type: 'item', label: 'Delete table', icon: Trash2, destructive: true, run: (e) => e.chain().focus().deleteTable().run() },
]

export function TableContextMenu({ editor, pos, onClose }: TableContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(pos.x, vw - 200))
  const top = Math.max(8, Math.min(pos.y, vh - 320))

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[11rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {TABLE_MENU_ENTRIES.map((entry, i) =>
        entry.type === 'separator' ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={entry.label}
            type="button"
            onClick={() => { entry.run(editor); onClose() }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default outline-none hover:bg-accent hover:text-accent-foreground',
              entry.destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
            )}
          >
            <entry.icon className={cn('size-4', !entry.destructive && 'text-muted-foreground')} />
            <span>{entry.label}</span>
          </button>
        ),
      )}
    </div>
  )

  return createPortal(menu, document.body)
}
