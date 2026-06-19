import { useState } from 'react'
import { Copy, MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { showNativeContextMenu } from '@/lib/native-context-menu'
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

function captureByContentSearch(
  filePath: string,
  selectedText: string,
  fileContent?: string | null,
): CapturedFileSelection | null {
  if (!selectedText) return null
  const plain: CapturedFileSelection = { copyText: selectedText, quoteText: selectedText }
  if (!fileContent) return plain

  const firstIdx = fileContent.indexOf(selectedText)
  if (firstIdx < 0) return plain
  if (fileContent.indexOf(selectedText, firstIdx + 1) >= 0) return plain

  const before = fileContent.slice(0, firstIdx)
  const matchEnd = firstIdx + selectedText.length
  const beforeEnd = fileContent.slice(0, matchEnd)
  const startLine = before.split('\n').length
  const endLine = beforeEnd.split('\n').length
  const startCol = before.length - (before.lastIndexOf('\n') + 1)
  const endCol = beforeEnd.length - (beforeEnd.lastIndexOf('\n') + 1)

  const lineNums: number[] = []
  for (let n = startLine; n <= endLine; n++) lineNums.push(n)
  const compressed = compressLineRanges(lineNums)
  if (!compressed) return plain

  const fileLines = fileContent.split('\n')
  const body = fileLines.slice(startLine - 1, endLine).join('\n')
  const prefix = formatFilePrefix(filePath, compressed, startCol, endCol, false)
  return { copyText: selectedText, quoteText: `${prefix}\n${body}` }
}

export function captureFileSelection(filePath: string, selection: Selection | null, fileContent?: string | null): CapturedFileSelection | null {
  if (!selection || selection.rangeCount === 0) return null
  const fallbackText = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const startRow = findRowAncestor(range.startContainer)
  const endRow = findRowAncestor(range.endContainer)

  if (!startRow || !endRow) {
    return captureByContentSearch(filePath, fallbackText, fileContent)
  }

  const rows: Element[] = []
  let cur: Element | null = startRow
  while (cur) {
    rows.push(cur)
    if (cur === endRow) break
    cur = cur.nextElementSibling
  }
  if (rows[rows.length - 1] !== endRow) {
    return captureByContentSearch(filePath, fallbackText, fileContent)
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
  const { t } = useTranslation()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const liquidGlass = useAppStore((s) => s.liquidGlass)

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const captured = captureFileSelection(filePath, window.getSelection(), fileContent)
    if (!captured) return
    if (!captured.copyText && !captured.quoteText) return
    if (liquidGlass) {
      void showNativeContextMenu([
        { id: 'copy', label: t('chat.selectionMenu.copy'), icon: Copy, onSelect: () => navigator.clipboard.writeText(captured.copyText) },
        { id: 'addToChat', label: t('chat.selectionMenu.addToChat'), icon: MessageSquarePlus, onSelect: () => addUserSelection(captured.quoteText) },
      ])
      return
    }
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
