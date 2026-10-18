import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Ellipsis, Maximize2, MicVocal, Minimize2, Music, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import { formatClockDuration } from '@superone/chat-view/presenters/duration-format'
import { mediaFileName, readAudioDetails, type AudioDetails, type Lyrics } from './audio-metadata'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

interface PlaybackState {
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  rate: number
}

const MEDIA_EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange', 'emptied'] as const

function readPlayback(el: HTMLMediaElement): PlaybackState {
  return {
    playing: !el.paused && !el.ended,
    currentTime: el.currentTime,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    volume: el.volume,
    muted: el.muted,
    rate: el.playbackRate,
  }
}

/** Mirror the element's own state; the element stays the single source of truth. */
function usePlayback(ref: RefObject<HTMLMediaElement | null>): PlaybackState {
  const [state, setState] = useState<PlaybackState>({ playing: false, currentTime: 0, duration: 0, volume: 1, muted: false, rate: 1 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = () => setState(readPlayback(el))
    sync()
    for (const name of MEDIA_EVENTS) el.addEventListener(name, sync)
    return () => {
      for (const name of MEDIA_EVENTS) el.removeEventListener(name, sync)
    }
  }, [ref])
  return state
}

function togglePlay(el: HTMLMediaElement | null) {
  if (!el) return
  if (el.paused || el.ended) void el.play().catch(() => {})
  else el.pause()
}

/** A thin track + fill with a native range on top, so keyboard and pointer seeking stay native. */
function MediaRange({ value, max, label, disabled, onChange, className }: {
  value: number
  max: number
  label: string
  disabled?: boolean
  onChange: (value: number) => void
  className?: string
}) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <span className={cn('group/range relative flex h-4 min-w-0 items-center', className)}>
      <span className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full bg-foreground/15">
        <span className="block h-full bg-foreground/80" style={{ width: `${percent}%` }} />
      </span>
      <input
        type="range"
        min={0}
        max={max || 1}
        step="any"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-default
                   [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:shadow
                   [&::-webkit-slider-thumb]:transition-opacity group-hover/range:[&::-webkit-slider-thumb]:opacity-100
                   focus-visible:[&::-webkit-slider-thumb]:opacity-100 disabled:[&::-webkit-slider-thumb]:hidden"
      />
    </span>
  )
}

function VolumeControl({ media, state }: { media: RefObject<HTMLMediaElement | null>; state: PlaybackState }) {
  const { t } = useTranslation()
  const silent = state.muted || state.volume === 0
  const Icon = silent ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2
  return (
    <span className="group/volume flex items-center">
      <IconButton
        size="md"
        tooltip={silent ? t('mediaPlayer.unmute') : t('mediaPlayer.mute')}
        onClick={() => {
          const el = media.current
          if (!el) return
          // Unmuting at zero volume would stay silent; restore an audible level.
          if (silent && el.volume === 0) el.volume = 1
          el.muted = !silent
        }}
      >
        <Icon />
      </IconButton>
      <span className="w-0 overflow-hidden transition-[width] duration-150 group-hover/volume:w-16 group-focus-within/volume:w-16">
        <MediaRange
          className="mx-1 w-14"
          label={t('mediaPlayer.volume')}
          value={state.muted ? 0 : state.volume}
          max={1}
          onChange={(v) => {
            const el = media.current
            if (!el) return
            el.volume = v
            el.muted = v === 0
          }}
        />
      </span>
    </span>
  )
}

interface MediaControlsProps {
  media: RefObject<HTMLMediaElement | null>
  state: PlaybackState
  /** Fullscreen target; omitted for audio. */
  root?: RefObject<HTMLElement | null>
  fullscreen?: boolean
  /** Player-specific buttons, placed before the options menu. */
  extra?: ReactNode
  className?: string
}

function MediaControls({ media, state, root, fullscreen = false, extra, className }: MediaControlsProps) {
  const { t } = useTranslation()
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root?.current?.requestFullscreen()
  }, [root])

  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <IconButton size="md" tooltip={state.playing ? t('mediaPlayer.pause') : t('mediaPlayer.play')} onClick={() => togglePlay(media.current)}>
        {state.playing ? <Pause /> : <Play />}
      </IconButton>
      {/* Left-anchored so the slider grows rightward and the icon stays under the pointer. */}
      <VolumeControl media={media} state={state} />
      <MediaRange
        className="mx-1 flex-1"
        label={t('mediaPlayer.seek')}
        value={state.currentTime}
        max={state.duration}
        disabled={!state.duration}
        onChange={(v) => {
          if (media.current) media.current.currentTime = v
        }}
      />
      <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground">
        {formatClockDuration(state.currentTime * 1000)} / {formatClockDuration(state.duration * 1000)}
      </span>
      {extra}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton size="md" tooltip={t('mediaPlayer.moreOptions')}>
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        {/* Portaled into the player in fullscreen: only the fullscreen element's subtree paints. */}
        <DropdownMenuContent align="end" side="top" container={fullscreen ? root?.current : undefined} data-media-player-control>
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t('mediaPlayer.playbackSpeed')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(state.rate)}
            onValueChange={(v) => {
              if (media.current) media.current.playbackRate = Number(v)
            }}
          >
            {PLAYBACK_RATES.map((rate) => (
              <DropdownMenuRadioItem key={rate} value={String(rate)}>
                {rate === 1 ? t('mediaPlayer.normalSpeed') : `${rate}×`}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {root && (
        <IconButton
          size="md"
          tooltip={fullscreen ? t('mediaPlayer.exitFullscreen') : t('mediaPlayer.enterFullscreen')}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
      )}
    </span>
  )
}

/**
 * Shared video player: centered with the controls on a bar beneath it.
 * Rendered with spans because `![…](clip.mp4)` lands inside a `<p>`.
 */
interface MarkdownVideoPlayerProps extends ComponentProps<'video'> {
  /** Fit the video and control bar inside a file preview's bounded stage. */
  fitToContainer?: boolean
  allowFullscreen?: boolean
}

export function MarkdownVideoPlayer({ className, style, controls: _controls, fitToContainer = false, allowFullscreen = true, ...props }: MarkdownVideoPlayerProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playback = usePlayback(videoRef)
  const [fullscreen, setFullscreen] = useState(false)
  const bounded = fitToContainer || fullscreen

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  return (
    <span
      ref={rootRef}
      data-slot="markdown-video"
      className={cn('my-3 flex w-full flex-col', bounded && 'my-0 h-full min-h-0', fullscreen && 'bg-background', className)}
    >
      <span className={cn('flex justify-center', bounded && 'min-h-0 flex-1 items-center', fullscreen && 'bg-black')}>
        <video
          ref={videoRef}
          preload="metadata"
          {...props}
          style={style}
          onClick={() => togglePlay(videoRef.current)}
          onDoubleClick={() => {
            if (!allowFullscreen) return
            if (document.fullscreenElement) void document.exitFullscreen()
            else void rootRef.current?.requestFullscreen()
          }}
          className={cn(
            'block max-w-full cursor-pointer bg-black',
            bounded ? 'size-full object-contain' : 'max-h-[32rem]',
            !fullscreen && 'rounded-lg',
          )}
        />
      </span>
      <MediaControls
        media={videoRef}
        state={playback}
        root={allowFullscreen ? rootRef : undefined}
        fullscreen={fullscreen}
        className={cn('mt-1.5 shrink-0 border-t border-border/60 pt-1.5', fullscreen && 'mt-0 px-3 py-2')}
      />
    </span>
  )
}

/** Tags, cover and lyrics, read once the audio has a playable source. */
function useAudioDetails(displaySrc: string | undefined, source: string | undefined): AudioDetails & { coverUrl?: string } {
  const [details, setDetails] = useState<AudioDetails>({ lyrics: null })
  useEffect(() => {
    setDetails({ lyrics: null })
    if (!displaySrc) return
    const controller = new AbortController()
    void readAudioDetails(displaySrc, source, controller.signal).then((next) => {
      if (!controller.signal.aborted) setDetails(next)
    })
    return () => controller.abort()
  }, [displaySrc, source])
  const coverUrl = useMemo(() => (details.cover ? URL.createObjectURL(details.cover) : undefined), [details.cover])
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl) }, [coverUrl])
  return { ...details, coverUrl }
}

/** Synced lines follow playback and seek on click; plain lyrics just scroll. */
function LyricsPanel({ lyrics, media, currentTime }: { lyrics: Lyrics; media: RefObject<HTMLMediaElement | null>; currentTime: number }) {
  const scrollRef = useRef<HTMLSpanElement>(null)
  const lines = lyrics.kind === 'synced' ? lyrics.lines : null
  // Slightly ahead, so a line lights up as it is sung rather than after.
  const active = lines ? lines.findLastIndex((line) => line.time <= currentTime + 0.2) : -1

  useEffect(() => {
    const container = scrollRef.current
    const line = container?.querySelector<HTMLElement>(`[data-line="${active}"]`)
    if (!container || !line) return
    // Scroll the panel only — `scrollIntoView` would drag the whole chat along.
    container.scrollTo({ top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' })
  }, [active])

  return (
    <span
      ref={scrollRef}
      data-slot="markdown-audio-lyrics"
      className="relative block max-h-48 overflow-y-auto border-t border-border/60 px-3 py-2 text-sm leading-relaxed"
    >
      {lyrics.kind === 'synced' ? (
        lyrics.lines.map((line, index) => (
          <button
            key={`${line.time}-${index}`}
            type="button"
            data-line={index}
            aria-current={index === active ? 'true' : undefined}
            onClick={() => {
              const el = media.current
              if (!el) return
              el.currentTime = line.time
              if (el.paused) void el.play().catch(() => {})
            }}
            className={cn(
              'block w-full cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-muted',
              index === active ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {line.text || '\u00a0'}
          </button>
        ))
      ) : (
        <span className="block whitespace-pre-wrap px-1 text-muted-foreground">{lyrics.text}</span>
      )}
    </span>
  )
}

interface MarkdownAudioPlayerProps extends ComponentProps<'audio'> {
  /** The original source, for the file name and a sibling `.lrc`; defaults to `src`. */
  source?: string
}

/**
 * Shared audio player: cover and title over the controls, with the file's lyrics
 * a toggle away. The file name stands in for a missing title.
 */
export function MarkdownAudioPlayer({ className, style: _style, controls: _controls, source, ...props }: MarkdownAudioPlayerProps) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement>(null)
  const playback = usePlayback(audioRef)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const details = useAudioDetails(props.src, source ?? props.src)
  const fileName = mediaFileName(source ?? props.src)
  const title = details.title ?? fileName ?? t('mediaPlayer.untitledAudio')
  const subtitle = [details.artist, details.album].filter(Boolean).join(' · ')

  return (
    <span
      data-slot="markdown-audio"
      className={cn('my-2 flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-muted/40', className)}
    >
      <audio ref={audioRef} preload="metadata" {...props} className="hidden" />
      <span className="flex items-center gap-3 px-2.5 pt-2.5">
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {details.coverUrl ? <img src={details.coverUrl} alt="" className="size-full object-cover" /> : <Music className="size-5" />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground" title={fileName ?? undefined}>{title}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </span>
      </span>
      <MediaControls
        media={audioRef}
        state={playback}
        className="px-1 py-1"
        extra={details.lyrics && (
          <IconButton
            size="md"
            aria-pressed={lyricsOpen}
            tooltip={lyricsOpen ? t('mediaPlayer.hideLyrics') : t('mediaPlayer.showLyrics')}
            className={cn(lyricsOpen && 'bg-muted text-foreground')}
            onClick={() => setLyricsOpen((open) => !open)}
          >
            <MicVocal />
          </IconButton>
        )}
      />
      {lyricsOpen && details.lyrics && <LyricsPanel lyrics={details.lyrics} media={audioRef} currentTime={playback.currentTime} />}
    </span>
  )
}
