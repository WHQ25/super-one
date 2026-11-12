import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { gutterWidth, useHighlightedTokens } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useChatStore } from '@/stores/chat-store'
import { formatDiffHunkQuote, type EditorDiffChange } from './editor-diff'

interface DiffHunkHoverCardProps {
  change: EditorDiffChange
  anchorRect: { top: number; bottom: number; left: number; right: number }
  language: string
  filePath: string
  fileRoot: string | null
  onRevert: (change: EditorDiffChange) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function DiffHunkHoverCard({
  change,
  anchorRect,
  language,
  filePath,
  fileRoot,
  onRevert,
  onMouseEnter,
  onMouseLeave,
}: DiffHunkHoverCardProps) {
  const { t } = useTranslation()
  const addUserSelection = useChatStore((s) => s.addUserSelection)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(() => ({
    left: Math.max(8, anchorRect.right + 6),
    top: Math.max(8, anchorRect.top),
  }))

  const cache = useMemo(() => getHighlightCache(fileRoot), [fileRoot])
  const oldCode = useMemo(() => change.oldLines.join('\n'), [change.oldLines])
  const newCode = useMemo(() => change.newLines.join('\n'), [change.newLines])
  const oldTokens = useHighlightedTokens(oldCode, language, { cache })
  const newTokens = useHighlightedTokens(newCode, language, { cache })

  const maxLineNum = Math.max(
    change.oldLines.length > 0 ? change.oldStartLine + change.oldLines.length - 1 : 0,
    change.newLines.length > 0 ? change.newEndLine : 0,
    1,
  )
  const gw = gutterWidth(maxLineNum)

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768
    const rect = el.getBoundingClientRect()
    const cardW = rect.width || 360
    const cardH = rect.height || 160
    const left = Math.max(8, Math.min(anchorRect.right + 6, vw - cardW - 12))
    const top = Math.max(8, Math.min(anchorRect.top, vh - cardH - 12))
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [anchorRect.right, anchorRect.top, change.id])

  const kindLabel = change.kind === 'added'
    ? t('filePreview.diffAdded')
    : change.kind === 'modified'
      ? t('filePreview.diffModified')
      : t('filePreview.diffDeleted')

  const lineBadge = change.kind === 'deleted'
    ? `L${change.anchorLine}`
    : change.newStartLine === change.newEndLine
      ? `L${change.newStartLine}`
      : `L${change.newStartLine}-L${change.newEndLine}`

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      data-testid="diff-hunk-hover-card"
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 min-w-[280px] max-w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-2.5 py-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{kindLabel}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{lineBadge}</span>
          <span className="flex items-center gap-1 font-mono text-[11px]">
            {change.newLines.length > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">+{change.newLines.length}</span>
            )}
            {change.oldLines.length > 0 && (
              <span className="text-rose-600 dark:text-rose-400">-{change.oldLines.length}</span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            size="sm"
            variant="ghost"
            data-testid="diff-hunk-add-to-chat"
            tooltip={t('chat.selectionMenu.addToChat')}
            onClick={() => addUserSelection(formatDiffHunkQuote(filePath, change))}
          >
            <MessageSquarePlus />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            data-testid="diff-hunk-revert"
            tooltip={t('filePreview.revertChange')}
            onClick={() => onRevert(change)}
          >
            <RotateCcw />
          </IconButton>
        </div>
      </div>
      <div className="max-h-60 overflow-auto py-1 font-mono text-xs leading-relaxed">
        <div className="min-w-max">
          {change.oldLines.map((line, i) => {
            const tokens = oldTokens?.[i]
            return (
              <div
                key={`old-${i}`}
                data-diff-preview-kind="removed"
                className="flex whitespace-pre bg-red-500/15 pr-3"
              >
                <span
                  style={{ width: `calc(${gw}ch + 0.75rem)` }}
                  className="shrink-0 select-none pl-2 pr-1 text-right text-muted-foreground/60"
                >
                  {change.oldStartLine + i}
                </span>
                <span className="inline-block w-[1.5ch] shrink-0 select-none text-center text-red-600/70 dark:text-red-400/70">
                  -
                </span>
                <span>
                  {tokens
                    ? tokens.map((tok, j) => <span key={j} style={tok.style}>{tok.content}</span>)
                    : (line || ' ')}
                </span>
              </div>
            )
          })}
          {change.newLines.map((line, i) => {
            const tokens = newTokens?.[i]
            return (
              <div
                key={`new-${i}`}
                data-diff-preview-kind="added"
                className="flex whitespace-pre bg-green-500/15 pr-3"
              >
                <span
                  style={{ width: `calc(${gw}ch + 0.75rem)` }}
                  className="shrink-0 select-none pl-2 pr-1 text-right text-muted-foreground/60"
                >
                  {change.newStartLine + i}
                </span>
                <span className="inline-block w-[1.5ch] shrink-0 select-none text-center text-green-600/70 dark:text-green-400/70">
                  +
                </span>
                <span>
                  {tokens
                    ? tokens.map((tok, j) => <span key={j} style={tok.style}>{tok.content}</span>)
                    : (line || ' ')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
