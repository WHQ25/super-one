import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Copy, MessageCirclePlus, MessageSquarePlus, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore, useSessionScope } from '@/stores/chat'
import type { SessionWriteTarget } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { showNativeContextMenu } from '@/lib/native-context-menu'
import { requestSideChat, useCanOpenSideChat } from '@/lib/side-chat-actions'

export interface SelectionMenuPos {
  x: number
  y: number
}

export interface ContextMenuAction {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
}

export type ContextMenuEntry = ContextMenuAction | { separator: true }

function isSeparator(entry: ContextMenuEntry): entry is { separator: true } {
  return 'separator' in entry
}

export function ContextMenuPopover({
  pos,
  actions,
  onClose,
}: {
  pos: SelectionMenuPos
  actions: ContextMenuEntry[]
  onClose: () => void
}) {
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
  const estHeight = actions.reduce((h, entry) => h + (isSeparator(entry) ? 9 : 32), 8)
  const left = vw ? Math.max(8, Math.min(pos.x, vw - 200)) : pos.x
  const top = vh ? Math.max(8, Math.min(pos.y, vh - estHeight - 8)) : pos.y

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((entry, i) =>
        isSeparator(entry) ? (
          <div key={`sep-${i}`} className="-mx-1 my-1 h-px bg-border" />
        ) : (
          <button
            key={entry.id}
            type="button"
            onClick={() => { entry.onSelect(); onClose() }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default outline-none hover:bg-accent hover:text-accent-foreground"
          >
            <entry.icon className="size-4 text-muted-foreground" />
            <span>{entry.label}</span>
          </button>
        ),
      )}
    </div>
  )

  if (typeof document === 'undefined') return menu
  return createPortal(menu, document.body)
}

interface SelectionMenuProps {
  pos: SelectionMenuPos
  onCopy: () => void
  onAddToChat: () => void
  onAskInSideChat?: () => void
  onClose: () => void
}

export function SelectionMenu({ pos, onCopy, onAddToChat, onAskInSideChat, onClose }: SelectionMenuProps) {
  const { t } = useTranslation()
  return (
    <ContextMenuPopover
      pos={pos}
      onClose={onClose}
      actions={[
        { id: 'copy', label: t('chat.selectionMenu.copy'), icon: Copy, onSelect: onCopy },
        { id: 'addToChat', label: t('chat.selectionMenu.addToChat'), icon: MessageSquarePlus, onSelect: onAddToChat },
        // Absent, not disabled, on a harness that cannot fork: the action's whole
        // value is that the side chat already knows the conversation.
        ...(onAskInSideChat
          ? [{ id: 'askInSideChat', label: t('chat.selectionMenu.askInSideChat'), icon: MessageCirclePlus, onSelect: onAskInSideChat }]
          : []),
      ]}
    />
  )
}

interface MenuState {
  x: number
  y: number
  text: string
}

export function useSelectionMenu(target?: SessionWriteTarget) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const canSideChat = useCanOpenSideChat()
  const addToChat = (text: string) => addUserSelection(text, target)
  // Lands the quote in the side chat's composer, so the selection never touches
  // the main chat's input on the way. `reuseOpen` keeps a running side chat: a
  // second question about a second selection is a follow-up, not a new thread.
  const askInSideChat = (text: string) => { void requestSideChat({ quote: text, reuseOpen: true }) }

  const openMenu = (text: string, x: number, y: number) => {
    const selText = text.trim()
    if (!selText) return
    if (liquidGlass) {
      void showNativeContextMenu([
        { id: 'copy', label: t('chat.selectionMenu.copy'), icon: Copy, onSelect: () => navigator.clipboard.writeText(selText) },
        { id: 'addToChat', label: t('chat.selectionMenu.addToChat'), icon: MessageSquarePlus, onSelect: () => addToChat(selText) },
        ...(canSideChat
          ? [{ id: 'askInSideChat', label: t('chat.selectionMenu.askInSideChat'), icon: MessageCirclePlus, onSelect: () => askInSideChat(selText) }]
          : []),
      ])
      return
    }
    setMenu({ x, y, text: selText })
  }

  const menuNode = menu ? (
    <SelectionMenu
      pos={{ x: menu.x, y: menu.y }}
      onCopy={() => navigator.clipboard.writeText(menu.text)}
      onAddToChat={() => addToChat(menu.text)}
      onAskInSideChat={canSideChat ? () => askInSideChat(menu.text) : undefined}
      onClose={() => setMenu(null)}
    />
  ) : null

  return { openMenu, menuNode }
}

interface SelectionContextMenuZoneProps {
  children: React.ReactNode
  className?: string
}

export function SelectionContextMenuZone({ children, className }: SelectionContextMenuZoneProps) {
  const sessionScope = useSessionScope()
  const { openMenu, menuNode } = useSelectionMenu(sessionScope ?? undefined)

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    openMenu(window.getSelection()?.toString() ?? '', event.clientX, event.clientY)
  }

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {children}
      {menuNode}
    </div>
  )
}
