import { useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { SelectionMenu } from '@/components/chat/SelectionContextMenu'
import { compressLineRanges, formatFilePrefix, lineKindToMarker, type LineKind } from '@/lib/file-quote-prefix'

export { compressLineRanges } from '@/lib/file-quote-prefix'

interface MenuState {
  x: number
  y: number
  copyText: string
  quoteText: string
}

interface FileSelectionContextMenuZoneProps {
  filePath: string
  fileContent?: string | null
  children: React.ReactNode
  className?: string
}

function findRowAncestor(node: Node | null): Element | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as Element
      const row = el.closest?.('[data-line]')
      if (row) return row
    }
    cur = cur.parentNode
  }
  return null
}

export function getRowCodeText(row: Element): string {
  let text = ''
  for (const child of Array.from(row.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element
      if (el.classList.contains('select-none')) continue
      text += el.textContent ?? ''
    } else {
      text += child.textContent ?? ''
    }
  }
  return text
}

export function getColInRow(row: Element, container: Node, offset: number): number {
  let col = 0
  let found = false

  function walk(node: Node): boolean {
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        col += offset
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        for (let i = 0; i < offset && i < el.childNodes.length; i++) {
          col += el.childNodes[i].textContent?.length ?? 0
        }
      }
      found = true
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      col += node.textContent?.length ?? 0
      return false
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      if (el.classList.contains('select-none')) return false
      for (const child of Array.from(el.childNodes)) {
        if (walk(child)) return true
      }
    }
    return false
  }

  for (const child of Array.from(row.childNodes)) {
    if (walk(child)) break
  }

  return found ? col : 0
}

export interface CapturedFileSelection {
  copyText: string
  quoteText: string
}

export function captureFileSelection(filePath: string, selection: Selection | null, fileContent?: string | null): CapturedFileSelection | null {
  if (!selection || selection.rangeCount === 0) return null
  const fallbackText = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const startRow = findRowAncestor(range.startContainer)
  const endRow = findRowAncestor(range.endContainer)

  if (!startRow || !endRow) {
    if (!fallbackText) return null
    return { copyText: fallbackText, quoteText: fallbackText }
  }

  const rows: Element[] = []
  let cur: Element | null = startRow
  while (cur) {
    rows.push(cur)
    if (cur === endRow) break
    cur = cur.nextElementSibling
  }
  if (rows[rows.length - 1] !== endRow) {
    if (!fallbackText) return null
    return { copyText: fallbackText, quoteText: fallbackText }
  }

  const fileLines = fileContent != null ? fileContent.split('\n') : null

  const rowData = rows.map((row) => {
    const lineNum = Number.parseInt(row.getAttribute('data-line') ?? '0', 10)
    const kindAttr = (row.getAttribute('data-line-kind') ?? 'unchanged') as LineKind
    const kind: LineKind = kindAttr === 'added' || kindAttr === 'removed' ? kindAttr : 'unchanged'
    const canonical = kind !== 'removed' && fileLines && lineNum >= 1 && lineNum <= fileLines.length
      ? fileLines[lineNum - 1]
      : getRowCodeText(row)
    return { lineNum, text: canonical, kind }
  })

  const startCol = getColInRow(startRow, range.startContainer, range.startOffset)
  const endCol = getColInRow(endRow, range.endContainer, range.endOffset)

  const lineNums = rowData.map((r) => r.lineNum)
  const compressed = compressLineRanges(lineNums)
  if (!compressed) {
    if (!fallbackText) return null
    return { copyText: fallbackText, quoteText: fallbackText }
  }

  const isDiff = rowData.some((r) => r.kind !== 'unchanged')
  const prefix = formatFilePrefix(filePath, compressed, startCol, endCol, isDiff)
  const body = rowData
    .map((r) => isDiff ? `${lineKindToMarker(r.kind)}${r.text}` : r.text)
    .join('\n')
  const copyText = sliceSelectedText(rowData, startCol, endCol)
  return {
    copyText: copyText || fallbackText,
    quoteText: `${prefix}\n${body}`,
  }
}

function sliceSelectedText(rows: { text: string }[], startCol: number, endCol: number): string {
  if (rows.length === 0) return ''
  if (rows.length === 1) {
    return rows[0].text.slice(startCol, endCol)
  }
  const first = rows[0].text.slice(startCol)
  const last = rows[rows.length - 1].text.slice(0, endCol)
  const middle = rows.slice(1, -1).map((r) => r.text)
  return [first, ...middle, last].join('\n')
}

export function FileSelectionContextMenuZone({ filePath, fileContent, children, className }: FileSelectionContextMenuZoneProps) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const addUserSelection = useChatStore((s) => s.addUserSelection)

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const captured = captureFileSelection(filePath, window.getSelection(), fileContent)
    if (!captured) return
    if (!captured.copyText && !captured.quoteText) return
    setMenu({ x: event.clientX, y: event.clientY, copyText: captured.copyText, quoteText: captured.quoteText })
  }

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {children}
      {menu && (
        <SelectionMenu
          pos={{ x: menu.x, y: menu.y }}
          onCopy={() => navigator.clipboard.writeText(menu.copyText)}
          onAddToChat={() => addUserSelection(menu.quoteText)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
