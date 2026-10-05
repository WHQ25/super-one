export async function tryCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Put an in-memory image on the clipboard. The async clipboard takes only PNG,
 * so any other type is redrawn through a canvas first.
 */
export async function tryCopyImage(mimeType: string, base64: string): Promise<boolean> {
  try {
    const png = mimeType === 'image/png'
      ? new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' })
      : await redrawAsPng(`data:${mimeType};base64,${base64}`)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  } catch {
    return false
  }
}

async function redrawAsPng(src: string): Promise<Blob> {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png')
  })
}

/** Put text plus an HTML flavour (e.g. with inline images) on the clipboard. */
export async function tryCopyRich(text: string, html: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })])
    return true
  } catch {
    return false
  }
}

/** Marks HTML that SuperOne put on the clipboard, so paste can trust its layout. */
export const SUPERONE_COPY_ATTR = 'data-superone-copy'

/** Wrap copied HTML so the composer recognises it on paste. */
export function markSuperOneCopy(html: string): string {
  return `<div ${SUPERONE_COPY_ATTR}="">${html}</div>`
}

/** A mention chip as the composer stores it. */
export type CopiedMention = { kind: string; value: string; displayName: string }

export type PastePart = { text: string } | { file: File } | { mention: CopiedMention } | { paste: string }

const MENTION_ATTR = 'data-superone-mention'
const PASTE_ATTR = 'data-superone-paste'

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (c) => ENTITIES[c]!)
const textHtml = (text: string): string => escapeHtml(text).replace(/\n/g, '<br>')

/** A mention in copied HTML: reads as its `@` text, pastes back into the composer as the chip. */
export function mentionCopyHtml(mention: CopiedMention, text: string): string {
  return `<span ${MENTION_ATTR}="${escapeHtml(JSON.stringify(mention))}">${textHtml(text)}</span>`
}

/** A paste chip in copied HTML: its full text on its own lines, pasted back as the chip. */
export function pasteCopyHtml(text: string): string {
  return `<div ${PASTE_ATTR}="">${textHtml(text)}</div>`
}

function copiedMention(raw: string): CopiedMention | null {
  try {
    const value = JSON.parse(raw) as Partial<CopiedMention>
    return typeof value.kind === 'string' && typeof value.value === 'string' && typeof value.displayName === 'string'
      ? { kind: value.kind, value: value.value, displayName: value.displayName }
      : null
  } catch {
    return null
  }
}

/** Text with `<br>` as line breaks, as pasteCopyHtml wrote it. */
function lineText(el: Element): string {
  return Array.from(el.childNodes, (node) => (node.nodeName === 'BR' ? '\n' : node.textContent ?? '')).join('')
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR'])

function dataImageFile(img: Element, index: number): File | null {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(img.getAttribute('src') ?? '')
  if (!match) return null
  const bytes = Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0))
  return new File([bytes], img.getAttribute('alt') || `image-${index + 1}`, { type: match[1] })
}

/**
 * A copied chat message, in order: text runs and the chips between them —
 * images (embedded as `data:` URIs), mentions and paste chips. Only HTML
 * SuperOne wrote counts — a web page's inline icons must not turn into
 * attachments. The HTML is parsed into an inert document and only read.
 */
export function pastePartsFromHtml(html: string): PastePart[] | null {
  if (!html.includes(SUPERONE_COPY_ATTR)) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.querySelector(`[${SUPERONE_COPY_ATTR}]`)
  if (!root) return null
  const parts: PastePart[] = []
  let text = ''
  let images = 0
  let chips = 0
  const chip = (part: PastePart): void => {
    if (text) parts.push({ text })
    text = ''
    parts.push(part)
    chips += 1
  }
  // A block starts and ends a line, also right after an image.
  const breakLine = (): void => {
    if (text ? !text.endsWith('\n') : parts.length > 0) text += '\n'
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (el.tagName === 'BR') {
      text += '\n'
      return
    }
    if (el.tagName === 'IMG') {
      const file = dataImageFile(el, images)
      if (!file) return
      images += 1
      chip({ file })
      return
    }
    const mention = el.getAttribute(MENTION_ATTR)
    if (mention !== null) {
      const parsed = copiedMention(mention)
      if (parsed) chip({ mention: parsed })
      else text += el.textContent ?? ''
      return
    }
    if (el.hasAttribute(PASTE_ATTR)) {
      chip({ paste: lineText(el) })
      return
    }
    const block = BLOCK_TAGS.has(el.tagName)
    if (block) breakLine()
    el.childNodes.forEach(walk)
    if (block) breakLine()
  }
  walk(root)
  if (text) parts.push({ text })
  if (chips === 0) return null
  // Block boundaries leave line breaks at the ends; a run that is only spacing goes.
  return parts.flatMap((part, index): PastePart[] => {
    if (!('text' in part)) return [part]
    let value = part.text
    if (index === 0) value = value.replace(/^\s+/, '')
    if (index === parts.length - 1) value = value.replace(/\s+$/, '')
    return value.trim() ? [{ text: value }] : []
  })
}
