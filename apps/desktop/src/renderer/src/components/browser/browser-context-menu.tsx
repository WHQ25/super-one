import { useState } from 'react'
import { Copy, MessageSquarePlus, Download, Link, ExternalLink, SquarePlus, Code, SquareDashedMousePointer, Camera } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { showNativeContextMenu } from '@/lib/native-context-menu'
import { ContextMenuPopover, type ContextMenuAction, type ContextMenuEntry } from '../chat/SelectionContextMenu'
import { useBrowserStore } from '@/stores/browser'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { addBrowserImageToChat, saveBrowserImage } from './browser-image'

type TranslateFn = ReturnType<typeof useTranslation>['t']

interface MenuState {
  x: number
  y: number
  entries: ContextMenuEntry[]
}

function joinSections(sections: ContextMenuAction[][]): ContextMenuEntry[] {
  return sections
    .filter((section) => section.length > 0)
    .flatMap((section, i): ContextMenuEntry[] => (i === 0 ? section : [{ separator: true }, ...section]))
}

function buildEntries(t: TranslateFn, wv: Electron.WebviewTag, e: Electron.ContextMenuEvent, browserId: string): ContextMenuEntry[] {
  const p = e.params
  const sections: ContextMenuAction[][] = []

  sections.push([
    { id: 'annotate', label: t('chat.browser.quickAnnotate'), icon: SquareDashedMousePointer, onSelect: () => useBrowserStore.getState().startAnnotate(browserId, 'plain') },
    { id: 'annotateShot', label: t('chat.browser.quickAnnotateWithScreenshot'), icon: Camera, onSelect: () => useBrowserStore.getState().startAnnotate(browserId, 'shot') },
  ])

  if (p.linkURL) {
    const link = p.linkURL
    sections.push([
      { id: 'copyLink', label: t('chat.browser.copyLink'), icon: Link, onSelect: () => void window.app.clipboardWrite(link) },
      { id: 'openLinkNewTab', label: t('chat.browser.openLinkNewTab'), icon: SquarePlus, onSelect: () => openBrowserTab(link) },
      { id: 'openLinkExternal', label: t('chat.browser.openLinkExternal'), icon: ExternalLink, onSelect: () => void window.app.openExternalLink(link) },
    ])
  }

  if (p.mediaType === 'image' && p.hasImageContents && p.srcURL) {
    const srcURL = p.srcURL
    sections.push([
      { id: 'addImage', label: t('chat.browser.addImageToChat'), icon: MessageSquarePlus, onSelect: () => void addBrowserImageToChat(srcURL) },
      { id: 'copyImage', label: t('chat.browser.copyImage'), icon: Copy, onSelect: () => void window.app.copyBrowserImageAt(wv.getWebContentsId(), p.x, p.y) },
      { id: 'copyImageAddress', label: t('chat.browser.copyImageAddress'), icon: Link, onSelect: () => void window.app.clipboardWrite(srcURL) },
      { id: 'saveImage', label: t('chat.browser.saveImage'), icon: Download, onSelect: () => {
        void saveBrowserImage(srcURL).then((res) => {
          if (res.ok) toast.success(t('chat.browser.imageSaved'))
          else if (!res.canceled) toast.error(t('chat.browser.imageSaveFailed'))
        })
      } },
    ])
  }

  const text = p.selectionText?.trim()
  if (text) {
    sections.push([
      { id: 'addText', label: t('chat.browser.addTextToChat'), icon: MessageSquarePlus, onSelect: () => useChatStore.getState().addUserSelection(text) },
      { id: 'copy', label: t('chat.browser.copyText'), icon: Copy, onSelect: () => void window.app.clipboardWrite(text) },
    ])
  }

  sections.push([
    { id: 'inspect', label: t('chat.browser.inspect'), icon: Code, onSelect: () => wv.inspectElement(p.x, p.y) },
  ])

  return joinSections(sections)
}

export function useBrowserContextMenu(browserId: string) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const liquidGlass = useAppStore((s) => s.liquidGlass)

  const handleContextMenu = (wv: Electron.WebviewTag, e: Electron.ContextMenuEvent) => {
    if (useBrowserStore.getState().annotatingId === browserId) return
    const entries = buildEntries(t, wv, e, browserId)
    if (entries.length === 0) return
    if (liquidGlass) {
      void showNativeContextMenu(
        entries.map((entry) =>
          'separator' in entry
            ? { type: 'separator' as const }
            : { id: entry.id, label: entry.label, icon: entry.icon, onSelect: entry.onSelect },
        ),
      )
      return
    }
    const slot = useBrowserStore.getState().slots[browserId]
    setMenu({ x: (slot?.left ?? 0) + e.params.x, y: (slot?.top ?? 0) + e.params.y, entries })
  }

  const menuNode = menu ? (
    <ContextMenuPopover pos={{ x: menu.x, y: menu.y }} actions={menu.entries} onClose={() => setMenu(null)} />
  ) : null

  return { handleContextMenu, menuNode }
}
