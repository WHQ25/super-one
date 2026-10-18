import { STICKY_UI_ATTR } from './plan-sticky-visuals'

/** Where a new comment attaches in the transcript. */
export interface ReplyCommentAnchor {
  /** `data-message-id` of the row the passage starts in; null outside any row. */
  messageId: string | null
  /** The passage's raw text, as its text nodes concatenate, to find it again. */
  anchorText: string
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

/** Text nodes of `root` the range selects at least one character of, sticky UI excluded. */
function selectedTextNodes(range: Range, root: HTMLElement): Text[] {
  const common = elementOf(range.commonAncestorContainer)
  const scope = common && root.contains(common) ? common : root
  const nodes: Text[] = []
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.length || !range.intersectsNode(n)) continue
    if (n === range.startContainer && range.startOffset >= n.length) continue
    if (n === range.endContainer && range.endOffset === 0) continue
    if (n.parentElement?.closest(`[${STICKY_UI_ATTR}]`)) continue
    nodes.push(n)
  }
  // Whitespace between blocks at either end is no part of the passage.
  while (nodes[0] && !nodes[0].data.trim()) nodes.shift()
  while (nodes.length && !nodes[nodes.length - 1]!.data.trim()) nodes.pop()
  return nodes
}

/**
 * The anchor for commenting on a selection: the part of it inside the
 * transcript `root`, or null when that holds no text.
 */
export function replyCommentAnchor(selection: Selection | null, root: HTMLElement): ReplyCommentAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const nodes = selectedTextNodes(range, root)
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (!first || !last) return null
  const clipped = document.createRange()
  clipped.setStart(first, first === range.startContainer ? range.startOffset : 0)
  clipped.setEnd(last, last === range.endContainer ? range.endOffset : last.length)
  const anchorText = clipped.toString()
  if (!anchorText.trim()) return null
  const row = elementOf(first)?.closest<HTMLElement>('[data-message-id]')
  return { messageId: row?.dataset.messageId ?? null, anchorText }
}

const editListeners = new Set<(id: string) => void>()

/** Open a saved comment's note in the transcript showing it (composer chip → note). */
export function requestReplyCommentEdit(id: string): void {
  for (const listener of editListeners) listener(id)
}

export function onReplyCommentEditRequest(listener: (id: string) => void): () => void {
  editListeners.add(listener)
  return () => { editListeners.delete(listener) }
}
