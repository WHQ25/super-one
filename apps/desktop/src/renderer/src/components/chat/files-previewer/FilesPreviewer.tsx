import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { NativeWidgetPayload, PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { PreviewerFullscreen } from './PreviewerFullscreen'
import { PreviewerStage } from './PreviewerStage'
import { PreviewerDots, PreviewerFileChip } from './previewer-chrome'
import { usePreviewerFile } from './use-previewer-file'

export interface FilesPreviewerProps {
  payload: NativeWidgetPayload
  projectPath?: string | null
}

/**
 * Fixed height so switching files never reflows the transcript. The chat pane
 * is the `@container` (ChatPanel.tsx); below `@lg` (512px) the pane is a
 * floating panel or a narrow split, where 640px would fill the whole viewport.
 */
export const PREVIEWER_CARD_HEIGHT_CLASS = 'h-[480px] @lg:h-[640px]'

/** True when the click landed on a media element's native control bar or on a button the stage owns. */
export function isStageControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('[data-previewer-media], [data-previewer-control]')
}

/**
 * The card: a fixed-height carousel of files with a note under each. It is a
 * stage, not a workspace — arrows and dots move between files, the stage click
 * opens fullscreen, and that is the whole interaction surface.
 */
export function FilesPreviewer({ payload, projectPath }: FilesPreviewerProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<PreviewerFile[]>(payload.files ?? [])
  const [index, setIndex] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const root = payload.root ?? ''

  useEffect(() => { setFiles(payload.files ?? []) }, [payload])

  const count = files.length
  const file = files[Math.min(index, count - 1)]
  const hasPrev = index > 0
  const hasNext = index < count - 1
  const goTo = useCallback((i: number) => setIndex(Math.max(0, Math.min(count - 1, i))), [count])

  const { state, markUndecodable, restat } = usePreviewerFile(root, file, true)

  // A retry re-asks the host for its verdict; a file that appeared since the call replaces its row.
  const retry = useCallback(async () => {
    const next = await restat()
    setFiles((prev) => prev.map((f) => (f.absolutePath === file.absolutePath ? { ...next, note: f.note } : f)))
  }, [restat, file.absolutePath])

  // The fullscreen renders inside this element through a portal, so its keys
  // bubble here through the React tree as well as to its own window listener.
  // React commits this handler's update before the native event reaches
  // `window`, so answering here too would move twice per press.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (fullscreen || isStageControlTarget(e.target)) return
    if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); goTo(index - 1) }
    else if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); goTo(index + 1) }
  }, [fullscreen, hasPrev, hasNext, index, goTo])

  // Capture phase: a click anywhere in the stage means "open", except on media
  // controls and the stage's own buttons. Links and copy buttons inside a
  // Markdown slide are swallowed here before they can act.
  const onStageClickCapture = useCallback((e: React.MouseEvent) => {
    if (isStageControlTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    setFullscreen(true)
  }, [])

  // Pause inline media while the fullscreen has the stage; two players of one clip is noise.
  useEffect(() => {
    if (!fullscreen) return
    stageRef.current?.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => m.pause())
  }, [fullscreen])

  const closeFullscreen = useCallback(() => {
    setFullscreen(false)
    fullscreenButtonRef.current?.focus()
  }, [])

  if (!file) return null
  const multi = count > 1

  return (
    <div
      className={cn('group/previewer @container my-3 flex flex-col overflow-hidden', PREVIEWER_CARD_HEIGHT_CLASS)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="files-previewer"
      data-index={index}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-1">
        <PreviewerFileChip file={file} className="min-w-0 flex-1" />
        {multi && (
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="previewer-counter">
            {t('chat.filesPreviewer.counter', { index: index + 1, total: count })}
          </span>
        )}
        <IconButton
          ref={fullscreenButtonRef}
          size="xs"
          variant="ghost"
          tooltip={t('chat.filesPreviewer.fullscreen')}
          onClick={() => setFullscreen(true)}
          data-previewer-control
        >
          <Expand />
        </IconButton>
      </div>

      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-transparent"
        onClickCapture={onStageClickCapture}
        onContextMenu={(e) => { if (!isStageControlTarget(e.target)) e.preventDefault() }}
        data-testid="previewer-stage"
      >
        <PreviewerStage
          file={file}
          state={state}
          mode="card"
          projectPath={projectPath}
          onUndecodable={markUndecodable}
          onRetry={retry}
        />
        {multi && (
          <>
            <NavArrow side="left" disabled={!hasPrev} onClick={() => goTo(index - 1)} label={t('chat.filesPreviewer.previous')} />
            <NavArrow side="right" disabled={!hasNext} onClick={() => goTo(index + 1)} label={t('chat.filesPreviewer.next')} />
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2 px-3 pt-3 pb-1">
        {file.note && (
          <div className="line-clamp-2 max-w-prose text-center text-xs leading-snug text-muted-foreground" title={file.note} data-testid="previewer-note">
            {file.note}
          </div>
        )}
        {multi && <PreviewerDots count={count} index={index} onSelect={goTo} />}
      </div>

      <PreviewerFullscreen
        open={fullscreen}
        onClose={closeFullscreen}
        files={files}
        index={index}
        onIndexChange={goTo}
        root={root}
        projectPath={projectPath}
        onFilesChange={setFiles}
      />
    </div>
  )
}

function NavArrow({ side, disabled, onClick, label }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void; label: string }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      data-previewer-control
      className={cn(
        'absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-muted hover:text-foreground disabled:opacity-30',
        'opacity-0 group-hover/previewer:opacity-100 focus-visible:opacity-100 @max-[480px]:opacity-100',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}
