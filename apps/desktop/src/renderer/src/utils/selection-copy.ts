import { markSuperOneCopy, mentionCopyHtml, pasteCopyHtml } from '@/lib/clipboard'
import { markdownOfRange } from './selection-markdown'

/**
 * Copying a selection in read-only chat: a chip that stands for more than its
 * label carries `data-copy-text` (a mention's `@path`, a paste chip's full
 * text). Both flavours swap that in. In the HTML flavour an image chip
 * (`data-copy-image`) becomes its `<img>`, and a mention (`data-copy-mention`)
 * or paste chip (`data-copy-paste`) the element the composer's paste turns
 * back into that chip, in place. A selection in a rendered reply copies as
 * Markdown (selection-markdown.ts). The composer serializes its own chips
 * (ProseMirror renderText).
 */
function htmlNodes(html: string): Node[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return Array.from(template.content.childNodes)
}

function copyNodes(chip: HTMLElement): Array<Node | string> {
  const text = chip.dataset.copyText ?? ''
  const mention = chip.dataset.copyMention
  if (mention) return htmlNodes(mentionCopyHtml(JSON.parse(mention), text))
  // The block element already puts the pasted text on its own lines.
  if (chip.dataset.copyPaste !== undefined) return htmlNodes(pasteCopyHtml(text.replace(/^\n|\n$/g, '')))
  const thumb = chip.dataset.copyImage !== undefined ? chip.querySelector('img') : null
  if (!thumb) return [text]
  const img = document.createElement('img')
  img.src = thumb.src
  img.alt = thumb.alt
  return [text, img, text]
}

/** innerText needs layout to turn blocks into line breaks, so measure off-screen. */
function plainTextOf(fragment: DocumentFragment): string {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre-wrap'
  host.append(fragment)
  document.body.append(host)
  const text = host.innerText
  host.remove()
  return text
}

/**
 * What copying a selection in read-only chat writes, or null where the
 * browser's own copy is right (inside the composer, or nothing to swap).
 */
export function selectionCopy(selection: Selection | null): { html: string; plain: string } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const common = range.commonAncestorContainer
  const scope = common instanceof Element ? common : common.parentElement
  if (!scope || scope.closest('[contenteditable="true"]')) return null
  // A selection inside one chip still copies the chip whole: it is atomic.
  const own = scope.closest<HTMLElement>('[data-copy-text]')
  const markdown = own ? null : markdownOfRange(range)
  const fragment = document.createDocumentFragment()
  fragment.append(own ? own.cloneNode(true) : range.cloneContents())
  const chips = fragment.querySelectorAll<HTMLElement>('[data-copy-text]')
  if (chips.length === 0 && markdown === null) return null
  for (const chip of chips) chip.replaceWith(...copyNodes(chip))
  const holder = document.createElement('div')
  holder.append(fragment.cloneNode(true))
  return {
    html: markSuperOneCopy(holder.innerHTML),
    // A chip that is its own content block pads its copy text with line breaks.
    plain: markdown ?? plainTextOf(fragment).replace(/^\n+|\n+$/g, ''),
  }
}

document.addEventListener('copy', (event) => {
  const copy = selectionCopy(document.getSelection())
  if (!copy || !event.clipboardData) return
  event.clipboardData.setData('text/html', copy.html)
  event.clipboardData.setData('text/plain', copy.plain)
  event.preventDefault()
})
