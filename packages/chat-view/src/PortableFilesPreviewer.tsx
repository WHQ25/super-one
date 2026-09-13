import { useCallback, useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { NativeWidgetPayload, PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { isInlinePreviewCandidate, isMarkdownFileName } from '@superone/shared/file-preview'
import { requestNative, requestNativeAsync } from './bridge'
import { PortableHostImage } from './PortableHostImage'
import { PortableHostVideo } from './PortableHostVideo'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableTurnContext } from './portable-turn-context'
import { resolveLanguage } from './portable-code-plugin'
import { beginSwipe, endSwipe, trackSwipe, type SwipeTracking } from './previewer-swipe'

/**
 * Card height on the phone. Shorter than the desktop's: a phone shows one
 * column, and 340px leaves the message above and the dots below on screen
 * together at the common viewport heights.
 */
export const PORTABLE_PREVIEWER_HEIGHT = 340

/** What the host answers a `loadTextFile` request with. */
export type LoadTextFileResult =
  | { text: string }
  /** The host will not put this file on the RPC; the row shows a chip instead. */
  | { tooLarge: true; size?: number }

type TextPhase =
  | { kind: 'loading' }
  | { kind: 'ready'; text: string }
  /** Any failure, including a host without `loadTextFile`; the chip stands in. */
  | { kind: 'fallback' }

/**
 * Text already fetched this session, by desktop path, bounded by characters so
 * a long transcript of source files cannot grow the WebView without limit.
 */
const TEXT_CACHE_CHARS = 4 * 1024 * 1024
const loadedText = new Map<string, string>()
let loadedChars = 0
const inflightText = new Map<string, Promise<TextPhase>>()

function rememberText(path: string, text: string): void {
  loadedText.set(path, text)
  loadedChars += text.length
  for (const [oldest, value] of loadedText) {
    if (loadedChars <= TEXT_CACHE_CHARS || oldest === path) break
    loadedText.delete(oldest)
    loadedChars -= value.length
  }
}

function parseTextResult(value: unknown): TextPhase {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  if (typeof record?.text === 'string') return { kind: 'ready', text: record.text }
  return { kind: 'fallback' }
}

function loadTextFile(path: string): Promise<TextPhase> {
  const cached = loadedText.get(path)
  if (cached !== undefined) return Promise.resolve({ kind: 'ready', text: cached })
  const pending = inflightText.get(path)
  if (pending) return pending
  const promise = requestNativeAsync('loadTextFile', { path })
    .then(parseTextResult, (): TextPhase => ({ kind: 'fallback' }))
    .then((phase) => {
      if (phase.kind === 'ready') rememberText(path, phase.text)
      inflightText.delete(path)
      return phase
    })
  inflightText.set(path, promise)
  return promise
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Fence the file as a code block so the phone's highlighter paints it; the fence outgrows any run of backticks inside. */
function fenceSource(name: string, text: string): string {
  const longest = text.match(/`{3,}/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const language = resolveLanguage(name.split('.').pop() ?? '') ?? ''
  return `${fence}${language}\n${text}\n${fence}`
}

/** A text-class file the host can put on the RPC: rendered in place, scrolling inside the card. */
function TextStage({ file, scheme }: { file: PreviewerFile; scheme: 'light' | 'dark' }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<TextPhase>(() => {
    const cached = loadedText.get(file.absolutePath)
    return cached !== undefined ? { kind: 'ready', text: cached } : { kind: 'loading' }
  })

  useEffect(() => {
    let live = true
    const cached = loadedText.get(file.absolutePath)
    if (cached !== undefined) {
      setPhase({ kind: 'ready', text: cached })
    } else {
      setPhase({ kind: 'loading' })
      void loadTextFile(file.absolutePath).then((next) => { if (live) setPhase(next) })
    }
    return () => { live = false }
  }, [file.absolutePath])

  if (phase.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-busy="true" aria-label={t('chat.filesPreviewer.loading')} data-previewer-text="loading">
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }
  if (phase.kind === 'fallback') return <ChipStage file={file} hint={t('chat.filesPreviewer.tapToOpen')} />

  const markdown = isMarkdownFileName(file.name)
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-3 py-2" data-previewer-text="ready">
      {/* Links and selection are inert in the card and the copy buttons are gone: the tap opens the real viewer. */}
      <div className={cn('pointer-events-none select-none [&_button]:hidden', markdown ? 'chat-md text-sm' : 'text-xs')}>
        <PortableMarkdown text={markdown ? phase.text : fenceSource(file.name, phase.text)} isStreaming={false} scheme={scheme} />
      </div>
    </div>
  )
}

/** Icon, name, size and a hint — the chip's content, also handed to the host image as its fallback. */
function ChipBody({ file, hint, tone = 'default' }: { file: PreviewerFile; hint: string; tone?: 'default' | 'error' }) {
  return (
    <>
      {tone === 'error'
        ? <AlertCircle className="size-7 text-muted-foreground" aria-hidden />
        : <FileIcon name={file.name} size={28} />}
      <span className="max-w-full truncate font-mono text-xs text-foreground">{file.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {file.size != null && tone === 'default' ? `${formatBytes(file.size)} · ` : ''}{hint}
      </span>
    </>
  )
}

/** What the card shows for anything it cannot render itself. */
function ChipStage(props: { file: PreviewerFile; hint: string; tone?: 'default' | 'error' }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center" data-previewer-chip={props.tone ?? 'default'}>
      <ChipBody {...props} />
    </div>
  )
}

function Stage({ file, scheme }: { file: PreviewerFile; scheme: 'light' | 'dark' }) {
  const { t } = useTranslation()
  switch (file.kind) {
    case 'image':
      // The host component owns loading / Load-over-relay / fallback; the wrapper
      // centres whichever it shows, and the chip names the file the way every
      // other stage does.
      return (
        <div className="flex h-full w-full items-center justify-center">
          <PortableHostImage
            path={file.absolutePath}
            label={file.name}
            className="flex flex-col items-center justify-center gap-1.5 px-6 text-center"
            pictureClassName="flex h-full w-full items-center justify-center"
            imageClassName="max-h-full max-w-full object-contain"
            fallback={<ChipBody file={file} hint={t('chat.filesPreviewer.tapToOpen')} />}
          />
        </div>
      )
    case 'video':
      return (
        <div className="flex h-full w-full items-center justify-center">
          <PortableHostVideo
            path={file.absolutePath}
            label={file.name}
            className="flex flex-col items-center justify-center gap-1.5 px-6 text-center"
            tileClassName="relative flex h-full w-full items-center justify-center bg-black"
          />
        </div>
      )
    case 'missing':
      return <ChipStage file={file} hint={t('chat.filesPreviewer.missing')} tone="error" />
    case 'unpreviewable':
      return (
        <ChipStage
          file={file}
          hint={file.reason === 'too_large'
            ? t('chat.filesPreviewer.unpreviewableTooLarge')
            : file.reason === 'outside_readable_roots'
              ? t('chat.filesPreviewer.unpreviewableOutside')
              : t('chat.filesPreviewer.unpreviewableBinary')}
        />
      )
    case 'text':
    case 'markdown':
      if (isInlinePreviewCandidate(file.name, file.size ?? Number.POSITIVE_INFINITY)) {
        return <TextStage file={file} scheme={scheme} />
      }
      return <ChipStage file={file} hint={t('chat.filesPreviewer.tapToOpen')} />
    default:
      // pdf, audio, notebook: the native viewer or the share sheet, never the WebView.
      return <ChipStage file={file} hint={t('chat.filesPreviewer.tapToOpen')} />
  }
}

/**
 * The phone's files previewer: a fixed-height carousel the finger pages
 * through, one file in the DOM at a time. The stage is a real preview for
 * images and small text, a poster for video, and a chip for the rest; a tap
 * anywhere on it opens the file in the shell's own fullscreen preview
 * (`previewFile`), so the card never grows a viewer of its own. No arrows —
 * swipe is the gesture, the dots are the position.
 */
export function PortableFilesPreviewer({ payload, toolUseId }: { payload: NativeWidgetPayload; toolUseId?: string }) {
  const { t } = useTranslation()
  const { scheme } = useContext(PortableTurnContext)
  const files = payload.files ?? []
  const [index, setIndex] = useState(0)
  const count = files.length
  const file = files[Math.min(index, count - 1)]
  const tracking = useRef<SwipeTracking | null>(null)
  // Set on a release that was a swipe; the click the browser synthesises next is dropped.
  const suppressClick = useRef(false)

  const goTo = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(count - 1, next)))
  }, [count])

  const open = useCallback(() => {
    if (!file || file.kind === 'missing') return
    requestNative('previewFile', { path: file.absolutePath })
  }, [file])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    tracking.current = beginSwipe(e.pointerId, e.clientX, e.clientY)
    suppressClick.current = false
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = tracking.current
    if (!current || current.pointerId !== e.pointerId) return
    tracking.current = trackSwipe(current, e.clientX, e.clientY)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = tracking.current
    if (!current || current.pointerId !== e.pointerId) return
    tracking.current = null
    const outcome = endSwipe(current)
    if (outcome === 'tap') return
    suppressClick.current = true
    if (outcome === 'prev') goTo(index - 1)
    else if (outcome === 'next') goTo(index + 1)
  }
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tracking.current?.pointerId === e.pointerId) tracking.current = null
    // The browser took the gesture (a vertical scroll); the release must not open anything.
    suppressClick.current = true
  }

  // One click handler for the whole stage. A release that ended a swipe is
  // dropped before anything inside sees it. A button inside — the host image
  // once its bytes are in, the video tile, a relay Load button — keeps its own
  // action, which already opens the right viewer; everywhere else the tap is
  // the file's, and opens it through `previewFile`.
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if ((e.target as Element).closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    open()
  }

  if (!file) return null
  const multi = count > 1

  return (
    <div
      className="my-2 flex flex-col overflow-hidden"
      style={{ height: PORTABLE_PREVIEWER_HEIGHT }}
      data-native-widget="files-previewer"
      data-tool-use-id={toolUseId}
      data-index={index}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 px-1">
        <FileIcon name={file.name} size={14} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={file.absolutePath}>{file.name}</span>
        {multi && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-previewer-counter>
            {t('chat.filesPreviewer.counter', { index: index + 1, total: count })}
          </span>
        )}
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-muted/30"
        style={{ touchAction: 'pan-y' }}
        data-previewer-stage
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        <Stage key={`${file.absolutePath}-${index}`} file={file} scheme={scheme} />
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5 px-3 pt-2 pb-0.5">
        {file.note && (
          <div className="line-clamp-2 max-w-prose text-center text-[13px] leading-snug text-muted-foreground" data-previewer-note>
            {file.note}
          </div>
        )}
        {multi && (
          <div className="flex items-center justify-center gap-1.5" data-previewer-dots>
            {files.map((f, i) => (
              <button
                key={`${f.absolutePath}-${i}`}
                type="button"
                aria-label={`${i + 1}`}
                aria-current={i === index}
                onClick={() => goTo(i)}
                className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-4 bg-foreground' : 'w-1.5 bg-border')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
