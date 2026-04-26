import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Copy, MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@/stores/chat'

interface MenuPos {
  x: number
  y: number
  text: string
}

function Menu({ pos, onClose }: { pos: MenuPos; onClose: () => void }) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const addUserSelection = useChatStore((s) => s.addUserSelection)

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

  const handleCopy = () => {
    navigator.clipboard.writeText(pos.text)
    onClose()
  }

  const handleAddToChat = () => {
    addUserSelection(pos.text)
    onClose()
  }

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
        onClick={handleCopy}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default outline-none hover:bg-accent hover:text-accent-foreground"
      >
        <Copy className="size-4 text-muted-foreground" />
        <span>{t('chat.selectionMenu.copy')}</span>
      </button>
      <button
        type="button"
        onClick={handleAddToChat}
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

interface SelectionContextMenuZoneProps {
  children: React.ReactNode
  className?: string
}

export function SelectionContextMenuZone({ children, className }: SelectionContextMenuZoneProps) {
  const [menu, setMenu] = useState<MenuPos | null>(null)

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const selText = window.getSelection()?.toString().trim() ?? ''
    if (!selText) return
    setMenu({ x: event.clientX, y: event.clientY, text: selText })
  }

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {children}
      {menu && <Menu pos={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
