import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { FullscreenGlassDialog } from '@/components/chat/FullscreenGlassDialog'
import { PreviewerStage } from './PreviewerStage'
import { PreviewerDots, PreviewerFileChip } from './previewer-chrome'
import { usePreviewerFile } from './use-previewer-file'

interface PreviewerFullscreenProps {
  open: boolean
  onClose: () => void
  files: PreviewerFile[]
  index: number
  onIndexChange: (index: number) => void
  root: string
  projectPath?: string | null
  onFilesChange: (update: (prev: PreviewerFile[]) => PreviewerFile[]) => void
}

/**
 * Where every real interaction lives: the panel's full renderers (zoomable
 * image, every PDF page, selectable text, media with download), dots to jump
 * between files, and the same header chip into the activity panel.
 */
export function PreviewerFullscreen({ open, onClose, files, index, onIndexChange, root, projectPath, onFilesChange }: PreviewerFullscreenProps) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const count = files.length
  const file = files[Math.min(index, count - 1)]
  const hasPrev = index > 0
  const hasNext = index < count - 1

  const { state, markUndecodable, restat } = usePreviewerFile(root, file, open)
  const retry = useCallback(async () => {
    const next = await restat()
    onFilesChange((prev) => prev.map((f) => (f.absolutePath === file.absolutePath ? { ...next, note: f.note } : f)))
  }, [restat, file.absolutePath, onFilesChange])

  // The dialog is the single owner of ← → while open; `ImagePreview` is mounted
  // with its own arrow handling off so the two never both fire.
  useEffect(() => {
    if (!open || count < 2) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); onIndexChange(index - 1) }
      else if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); onIndexChange(index + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, count, index, hasPrev, hasNext, onIndexChange])

  // `FullscreenGlassDialog` suppresses auto-focus; without this the arrow keys go nowhere.
  useEffect(() => {
    if (open) stageRef.current?.focus()
  }, [open])

  if (!file) return null

  return (
    <FullscreenGlassDialog open={open} onOpenChange={(next) => { if (!next) onClose() }} title={file.name}>
      <div className="flex h-full flex-col" data-testid="previewer-fullscreen">
        <div className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
          <span onClickCapture={onClose} className="flex min-w-0 flex-1">
            <PreviewerFileChip file={file} className="min-w-0" />
          </span>
          {count > 1 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {t('chat.filesPreviewer.counter', { index: index + 1, total: count })}
            </span>
          )}
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t('chat.filesPreviewer.close')}
            tooltip={<span className="inline-flex items-center gap-1.5">{t('chat.filesPreviewer.close')}<CommandShortcut className="tracking-normal">ESC</CommandShortcut></span>}
            onClick={onClose}
          >
            <X />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1">
          {count > 1 && <Gutter side="left" disabled={!hasPrev} onClick={() => onIndexChange(index - 1)} label={t('chat.filesPreviewer.previous')} />}
          <div ref={stageRef} tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted/30 outline-none">
            <PreviewerStage
              file={file}
              state={state}
              mode="fullscreen"
              projectPath={projectPath}
              onUndecodable={markUndecodable}
              onRetry={retry}
            />
          </div>
          {count > 1 && <Gutter side="right" disabled={!hasNext} onClick={() => onIndexChange(index + 1)} label={t('chat.filesPreviewer.next')} />}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2.5 px-3.5 pt-3 pb-2.5">
          {file.note && (
            <div className="max-w-prose text-center text-sm leading-snug text-foreground" data-testid="previewer-fullscreen-note">{file.note}</div>
          )}
          {count > 1 && <PreviewerDots count={count} index={index} onSelect={onIndexChange} />}
        </div>
      </div>
    </FullscreenGlassDialog>
  )
}

/**
 * The arrows live in their own columns beside the stage, never over it — a
 * zoomed image or a line of code is not something to read through a button.
 */
function Gutter({ side, disabled, onClick, label }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void; label: string }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <div className="flex w-14 shrink-0 items-center justify-center">
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onClick}
        className="size-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        aria-label={label}
      >
        <Icon className="size-5" />
      </Button>
    </div>
  )
}
