import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import { WEB_LINK_ATTR } from '../web-link-decoration'
import { LINK_PREVIEW_SURFACE, LinkPreviewContent } from './WebLink'
import { useLinkPreviewHover } from './use-link-preview-hover'

/**
 * The hover preview for links the composer draws (`WebLinkDecoration`). They
 * are decorations, not React, so hover is read off the editor's DOM and the
 * card anchors near the cursor. Typing closes it.
 */
export function ComposerLinkPreview({ editor }: { editor: Editor | null }) {
  const { target, open, anchor, hover, keepOpen, close, scheduleClose } = useLinkPreviewHover()

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view.dom
    const linkAt = (node: EventTarget | null) => (node instanceof Element ? node.closest(`[${WEB_LINK_ATTR}]`) : null)
    const over = (event: MouseEvent) => {
      const link = linkAt(event.target)
      if (!link) return
      const href = link.getAttribute(WEB_LINK_ATTR)!
      // Anchor to the text: the favicon widget sits right before it.
      const element = link.classList.contains('web-link') ? link : (link.nextElementSibling ?? link)
      hover(href, element, event)
    }
    const out = (event: MouseEvent) => {
      // Moving between a link's favicon and its text stays on the link.
      const from = linkAt(event.target)
      if (from && linkAt(event.relatedTarget)?.getAttribute(WEB_LINK_ATTR) !== from.getAttribute(WEB_LINK_ATTR)) scheduleClose()
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('mousemove', over)
    dom.addEventListener('mouseout', out)
    editor.on('update', close)
    return () => {
      close()
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('mousemove', over)
      dom.removeEventListener('mouseout', out)
      editor.off('update', close)
    }
  }, [editor, hover, close, scheduleClose])

  if (!target) return null
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) close() }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="center"
        sideOffset={12}
        className={cn(LINK_PREVIEW_SURFACE, 'bg-popover dark:bg-popover backdrop-blur-none')}
        // The caret stays in the draft.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
      >
        <LinkPreviewContent href={target.href} open={open} onClose={close} />
      </PopoverContent>
    </Popover>
  )
}
