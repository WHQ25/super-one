import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { NativeWidgetPayload, PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import type { ModelPreviewViewState } from '@/components/coding/ModelPreview'
import { PreviewerFullscreen } from './PreviewerFullscreen'
import { PreviewerStage } from './PreviewerStage'
import { PreviewerDots, PreviewerFileChip } from './previewer-chrome'
import { usePreviewerFile } from './use-previewer-file'
import { useStageContentHeight } from './use-stage-height'

export interface FilesPreviewerProps {
  payload: NativeWidgetPayload
  projectPath?: string | null
}

/**
 * `fill` is the fixed height a card takes when a slide fills whatever it gets
 * (text, PDF, model); `fit` caps a card sized to its tallest media slide
 * (use-stage-height.ts). The chat pane is the `@container` (ChatPanel.tsx);
 * below `@lg` (512px) the pane is a floating panel or a narrow split, where
 * 640px would fill the whole viewport.
 */
const PREVIEWER_CARD_HEIGHT_CLASS = { fill: 'h-[480px] @lg:h-[640px]', fit: 'max-h-[480px] @lg:max-h-[640px]' }

/** True when the click landed on a media element's native control bar or on a button the stage owns. */
export function isStageControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('[data-previewer-media], [data-previewer-control]')
}

/**
 * The card: a carousel, as tall as its tallest slide, of files with a note under each. It is a
 * stage, not a workspace — arrows and dots move between files, the stage click
 * opens fullscreen, and that is the whole interaction surface.
 */
export function FilesPreviewer({ payload, projectPath }: FilesPreviewerProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<PreviewerFile[]>(payload.files ?? [])
  const [index, setIndex] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [modelViewStates, setModelViewStates] = useState<Record<string, ModelPreviewViewState>>({})
  const cardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [cardWidth, setCardWidth] = useState(0)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const root = payload.root ?? ''

  useEffect(() => { setFiles(payload.files ?? []) }, [payload])

  const count = files.length
  const file = files[Math.min(index, count - 1)]
  const hasPrev = index > 0
  const hasNext = index < count - 1
  const goTo = useCallback((i: number) => setIndex(Math.max(0, Math.min(count - 1, i))), [count])

  const { state, markUndecodable, restat } = usePreviewerFile(root, file, true)
  const stageHeight = useStageContentHeight(root, files, cardWidth)

  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const observer = new ResizeObserver(([entry]) => setCardWidth(entry.contentRect.width))
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

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
  const handleModelViewStateChange = useCallback((modelFile: PreviewerFile, state: ModelPreviewViewState) => {
    setModelViewStates((current) => ({ ...current, [modelFile.absolutePath]: state }))
  }, [])

  if (!file) return null
  const multi = count > 1

  return (
    <div
      ref={cardRef}
      className={cn('group/previewer @container my-3 flex flex-col overflow-hidden', stageHeight === null ? PREVIEWER_CARD_HEIGHT_CLASS.fill : PREVIEWER_CARD_HEIGHT_CLASS.fit)}
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
        className={cn('relative flex min-h-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-transparent', stageHeight === null && 'flex-1')}
        style={stageHeight === null ? undefined : { height: stageHeight }}
        onClickCapture={onStageClickCapture}
        onContextMenu={(e) => { if (!isStageControlTarget(e.target)) e.preventDefault() }}
        data-testid="previewer-stage"
      >
        <PreviewerStage
          file={file}
          state={state}
          mode="card"
          projectPath={projectPath}
          initialModelViewState={modelViewStates[file.absolutePath] ?? null}
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
        {/* Every note stacks in one cell so the footer is as tall as the longest. */}
        {files.some((f) => f.note) && (
          <div className="grid max-w-prose">
            {files.map((f, i) => f.note && (
              <div
                key={i}
                className={cn('col-start-1 row-start-1 line-clamp-2 text-center text-xs leading-snug text-muted-foreground', f !== file && 'invisible')}
                title={f.note}
                aria-hidden={f !== file}
                data-testid={f === file ? 'previewer-note' : undefined}
              >
                {f.note}
              </div>
            ))}
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
        modelViewState={modelViewStates[file.absolutePath] ?? null}
        onModelViewStateChange={handleModelViewStateChange}
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
