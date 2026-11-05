import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, MessageSquarePlus, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { FullscreenGlassDialog } from '@/components/chat/FullscreenGlassDialog'
import type { ModelPreviewViewState } from '@/components/coding/ModelPreview'
import { localFileUrlToPath } from '@/lib/path-utils'
import { chatInputAPI } from '../chat-input-api'
import { ImageAnnotationEditor } from '../image-editor/ImageAnnotationEditor'
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
  modelViewState?: ModelPreviewViewState | null
  onModelViewStateChange?: (file: PreviewerFile, state: ModelPreviewViewState) => void
  onFilesChange: (update: (prev: PreviewerFile[]) => PreviewerFile[]) => void
}

/**
 * Where every real interaction lives: the panel's full renderers (zoomable
 * image, every PDF page, selectable text, shared media players), dots to jump
 * between files, and the same header chip into the activity panel.
 */
export function PreviewerFullscreen({ open, onClose, files, index, onIndexChange, root, projectPath, modelViewState, onModelViewStateChange, onFilesChange }: PreviewerFullscreenProps) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const count = files.length
  const file = files[Math.min(index, count - 1)]
  const hasPrev = index > 0
  const hasNext = index < count - 1
  const [editing, setEditing] = useState(false)
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null)

  const { state, markUndecodable, restat } = usePreviewerFile(root, file, open)
  const retry = useCallback(async () => {
    const next = await restat()
    onFilesChange((prev) => prev.map((f) => (f.absolutePath === file.absolutePath ? { ...next, note: f.note } : f)))
  }, [restat, file.absolutePath, onFilesChange])

  useEffect(() => {
    setEditing(false)
    setOverrideSrc(null)
  }, [open, index, file?.absolutePath])

  const isReadyImage = file?.kind === 'image' && state.status === 'ready' && Boolean(state.url)
  const resolvedLocalPath = isReadyImage && state.status === 'ready' && state.url
    ? localFileUrlToPath(state.url) ?? (!file.absolutePath.startsWith('data:') ? file.absolutePath : undefined)
    : undefined

  const handleQuickAddToChat = useCallback(async () => {
    if (!isReadyImage) return
    if (overrideSrc && overrideSrc.startsWith('data:') && chatInputAPI.addImageFromBase64) {
      const commaIdx = overrideSrc.indexOf(',')
      const base64 = commaIdx >= 0 ? overrideSrc.slice(commaIdx + 1) : ''
      if (base64) {
        await chatInputAPI.addImageFromBase64(base64, 'image/png', file.name)
        toast.success(t('chat.imageEditor.addedToChat'))
        onClose()
        return
      }
    }
    if (resolvedLocalPath && chatInputAPI.addImageFromPath) {
      await chatInputAPI.addImageFromPath(resolvedLocalPath)
      toast.success(t('chat.imageEditor.addedToChat'))
      onClose()
    }
  }, [isReadyImage, overrideSrc, resolvedLocalPath, file?.name, t, onClose])

  // The dialog is the single owner of ← → while open; `ImagePreview` is mounted
  // with its own arrow handling off so the two never both fire.
  useEffect(() => {
    if (!open || editing) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || target.closest?.('[data-media-player-control]'))) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isReadyImage) {
        e.preventDefault()
        e.stopPropagation()
        void handleQuickAddToChat()
        return
      }
      if (count < 2) return
      if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); onIndexChange(index - 1) }
      else if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); onIndexChange(index + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing, count, index, hasPrev, hasNext, onIndexChange, isReadyImage, handleQuickAddToChat])

  // `FullscreenGlassDialog` suppresses auto-focus; without this the arrow keys go nowhere.
  useEffect(() => {
    if (open && !editing) stageRef.current?.focus()
  }, [open, editing])

  if (!file) return null

  return (
    <FullscreenGlassDialog open={open} onOpenChange={(next) => { if (!next) onClose() }} title={file.name}>
      <div className="flex h-full flex-col" data-testid="previewer-fullscreen">
        {editing && isReadyImage && state.status === 'ready' && state.url ? (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ImageAnnotationEditor
              src={overrideSrc ?? state.url}
              alt={file.name}
              filePath={resolvedLocalPath}
              fileName={file.name}
              onSavedImage={(dataUrl) => {
                setOverrideSrc(dataUrl)
                void retry()
              }}
              onExitEdit={() => setEditing(false)}
              onCloseViewer={onClose}
            />
          </div>
        ) : (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
              <span onClickCapture={onClose} className="flex min-w-0 flex-1">
                <PreviewerFileChip file={file} className="min-w-0" />
              </span>
              {count > 1 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('chat.filesPreviewer.counter', { index: index + 1, total: count })}
                </span>
              )}
              {isReadyImage && (
                <>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t('chat.image.addToChat')}
                    tooltip={<span className="inline-flex items-center gap-1.5">{t('chat.image.addToChat')}<CommandShortcut className="tracking-normal">⌘↵</CommandShortcut></span>}
                    onClick={() => void handleQuickAddToChat()}
                    data-testid="previewer-fullscreen-add-to-chat-button"
                  >
                    <MessageSquarePlus />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t('chat.image.edit')}
                    tooltip={t('chat.image.edit')}
                    onClick={() => setEditing(true)}
                    data-testid="previewer-fullscreen-edit-button"
                  >
                    <Pencil />
                  </IconButton>
                </>
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
              <div ref={stageRef} tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-transparent outline-none" data-testid="previewer-fullscreen-stage">
                <PreviewerStage
                  file={file}
                  state={overrideSrc && state.status === 'ready' ? { ...state, url: overrideSrc } : state}
                  mode="fullscreen"
                  root={root}
                  projectPath={projectPath}
                  initialModelViewState={modelViewState}
                  onModelViewStateChange={(state) => onModelViewStateChange?.(file, state)}
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
          </>
        )}
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
