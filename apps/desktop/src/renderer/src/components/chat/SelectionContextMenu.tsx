import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Copy, MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore, useSessionScope } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { showNativeContextMenu } from '@/lib/native-context-menu'

export interface SelectionMenuPos {
  x: number
  y: number
}

interface SelectionMenuProps {
  pos: SelectionMenuPos
  onCopy: () => void
  onAddToChat: () => void
  onClose: () => void
}

export function SelectionMenu({ pos, onCopy, onAddToChat, onClose }: SelectionMenuProps) {
  const { t } = useTranslation()
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

  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const left = vw ? Math.max(8, Math.min(pos.x, vw - 180)) : pos.x
  const top = vh ? Math.max(8, Math.min(pos.y, vh - 100)) : pos.y

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={() => { onCopy(); onClose() }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default outline-none hover:bg-accent hover:text-accent-foreground"
      >
        <Copy className="size-4 text-muted-foreground" />
        <span>{t('chat.selectionMenu.copy')}</span>
      </button>
      <button
        type="button"
        onClick={() => { onAddToChat(); onClose() }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default outline-none hover:bg-accent hover:text-accent-foreground"
      >
        <MessageSquarePlus className="size-4 text-muted-foreground" />
        <span>{t('chat.selectionMenu.addToChat')}</span>
      </button>
    </div>
  )

  if (typeof document === 'undefined') return menu
  return createPortal(menu, document.body)
}

interface MenuState {
  x: number
  y: number
  text: string
}

interface SelectionContextMenuZoneProps {
  children: React.ReactNode
  className?: string
}

export function SelectionContextMenuZone({ children, className }: SelectionContextMenuZoneProps) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const sessionScope = useSessionScope()
  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const addToChat = (text: string) => addUserSelection(text, sessionScope ?? undefined)

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const selText = window.getSelection()?.toString().trim() ?? ''
    if (!selText) return
    if (liquidGlass) {
      void showNativeContextMenu([
        { id: 'copy', label: t('chat.selectionMenu.copy'), icon: Copy, onSelect: () => navigator.clipboard.writeText(selText) },
        { id: 'addToChat', label: t('chat.selectionMenu.addToChat'), icon: MessageSquarePlus, onSelect: () => addToChat(selText) },
      ])
      return
    }
    setMenu({ x: event.clientX, y: event.clientY, text: selText })
  }

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {children}
      {menu && (
        <SelectionMenu
          pos={{ x: menu.x, y: menu.y }}
          onCopy={() => navigator.clipboard.writeText(menu.text)}
          onAddToChat={() => addToChat(menu.text)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
