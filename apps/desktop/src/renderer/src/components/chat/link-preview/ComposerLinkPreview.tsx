import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import { WEB_LINK_ATTR } from '../web-link-decoration'
import { LINK_PREVIEW_SURFACE, LinkPreviewContent } from './WebLink'

const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 100

/**
 * The hover preview for links the composer draws (`WebLinkDecoration`). They
 * are decorations, not React, so hover is read off the editor's DOM and the
 * card anchors to the hovered link's box. Typing closes it.
 */
export function ComposerLinkPreview({ editor }: { editor: Editor | null }) {
  const [target, setTarget] = useState<{ href: string; element: Element } | null>(null)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view.dom
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
    const close = () => { clear(); current.current = null; setOpen(false) }
    const scheduleClose = () => { clear(); timer.current = setTimeout(close, CLOSE_DELAY_MS) }
    const linkAt = (node: EventTarget | null) => (node instanceof Element ? node.closest(`[${WEB_LINK_ATTR}]`) : null)
    const over = (event: MouseEvent) => {
      const link = linkAt(event.target)
      if (!link) return
      const href = link.getAttribute(WEB_LINK_ATTR)!
      // Anchor to the text: the favicon widget sits right before it.
      const element = link.classList.contains('web-link') ? link : (link.nextElementSibling ?? link)
      clear()
      if (element === current.current) return
      timer.current = setTimeout(() => {
        current.current = element
        setTarget({ href, element })
        setOpen(true)
      }, current.current ? 0 : OPEN_DELAY_MS)
    }
    const out = (event: MouseEvent) => {
      // Moving between a link's favicon and its text stays on the link.
      const from = linkAt(event.target)
      if (from && linkAt(event.relatedTarget)?.getAttribute(WEB_LINK_ATTR) !== from.getAttribute(WEB_LINK_ATTR)) scheduleClose()
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('mouseout', out)
    editor.on('update', close)
    return () => {
      clear()
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('mouseout', out)
      editor.off('update', close)
    }
  }, [editor])

  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => target?.element.getBoundingClientRect() ?? new DOMRect() } }), [target])
  const keepOpen = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const close = () => { keepOpen(); current.current = null; setOpen(false) }

  if (!target) return null
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) close() }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        className={cn(LINK_PREVIEW_SURFACE, 'bg-popover dark:bg-popover backdrop-blur-none')}
        // The caret stays in the draft.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={keepOpen}
        onMouseLeave={() => { keepOpen(); timer.current = setTimeout(close, CLOSE_DELAY_MS) }}
      >
        <LinkPreviewContent href={target.href} open={open} onClose={close} />
      </PopoverContent>
    </Popover>
  )
}
