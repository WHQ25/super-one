import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type JSX, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import computerUseBaseplate from '../assets/computer-use-baseplate.png'
import computerUseCursor from '../assets/computer-use-cursor.png'

type PermissionPane = 'accessibility' | 'screenRecording'
type Flow = 'guided' | 'single'

type PermissionSnapshot = {
  accessibility?: string
  screenRecording?: string
  helperName?: string
  helperBundleId?: string
  helperPath?: string
}

/**
 * guided phases:
 * - accessibility | accessibility_done | screenRecording | done
 * single phases:
 * - active | done (for the one pane)
 */
type GuidePhase =
  | 'accessibility'
  | 'accessibility_done'
  | 'screenRecording'
  | 'done'

/** Match the panel icon: Tailwind `size-12` = 48 CSS px (do not shrink with float). */
const PANEL_ICON_CSS_PX = 48
const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties

type DragIconPayload = { bytes: Uint8Array; scaleFactor: number }

function readBoot(): {
  flow: Flow
  pane: PermissionPane
  status: PermissionSnapshot
} {
  const params = new URLSearchParams(window.location.search)
  const flow: Flow = params.get('flow') === 'single' ? 'single' : 'guided'
  const pane: PermissionPane =
    params.get('pane') === 'screenRecording' ? 'screenRecording' : 'accessibility'
  return {
    flow,
    pane,
    status: {
      helperName: params.get('helperName') ?? '',
      helperBundleId: params.get('helperBundleId') ?? '',
      helperPath: params.get('helperPath') ? decodeURIComponent(params.get('helperPath')!) : '',
      accessibility: params.get('accessibility') ?? 'missing',
      screenRecording: params.get('screenRecording') ?? 'missing',
    },
  }
}

function initialPhase(flow: Flow, pane: PermissionPane, status: PermissionSnapshot): GuidePhase {
  if (flow === 'single') {
    const granted =
      pane === 'accessibility'
        ? status.accessibility === 'granted'
        : status.screenRecording === 'granted'
    return granted ? 'done' : pane === 'accessibility' ? 'accessibility' : 'screenRecording'
  }
  // guided
  if (status.accessibility === 'granted' && status.screenRecording === 'granted') return 'done'
  if (status.accessibility === 'granted') return 'accessibility_done'
  return 'accessibility'
}

async function buildDragIconPng(): Promise<DragIconPayload> {
  const scaleFactor = Math.max(1, Math.round(window.devicePixelRatio || 2))
  const size = PANEL_ICON_CSS_PX * scaleFactor
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`failed to load ${src}`))
      img.src = src
    })

  const [base, cursor] = await Promise.all([
    load(computerUseBaseplate),
    load(computerUseCursor),
  ])
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(base, 0, 0, size, size)
  const cursorSize = size * 0.5
  ctx.drawImage(
    cursor,
    (size - cursorSize) / 2,
    (size - cursorSize) / 2,
    cursorSize,
    cursorSize,
  )

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), scaleFactor }
}

/**
 * Permission float: guided (first enable) or single (per-button re-request).
 */
export function ComputerUsePermissionFloat(): JSX.Element {
  const { t } = useTranslation()
  const boot = useMemo(() => readBoot(), [])
  const [flow] = useState<Flow>(boot.flow)
  const [status, setStatus] = useState<PermissionSnapshot>(boot.status)
  const [phase, setPhase] = useState<GuidePhase>(() =>
    initialPhase(boot.flow, boot.pane, boot.status),
  )
  const dragIconRef = useRef<DragIconPayload | null>(null)
  const [dragEpoch, setDragEpoch] = useState(0)
  const [recheckBusy, setRecheckBusy] = useState(false)
  const [recheckHint, setRecheckHint] = useState<string | null>(null)

  const helperPath = status.helperPath ?? ''
  const helperName = status.helperName || t('settings.computerUse.permissions.helperName')

  useEffect(() => {
    let cancelled = false
    void buildDragIconPng()
      .then((payload) => {
        if (!cancelled) dragIconRef.current = payload
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.app.onComputerUsePermissionStatus((next) => {
      setStatus((prev) => ({
        ...prev,
        accessibility: next.accessibility ?? prev.accessibility,
        screenRecording: next.screenRecording ?? prev.screenRecording,
        helperName: next.helperName ?? prev.helperName,
        helperBundleId: next.helperBundleId ?? prev.helperBundleId,
        helperPath: next.helperPath ?? prev.helperPath,
      }))
      // Main may push pane when Continue is clicked (guided).
      if (next.pane === 'screenRecording' && flow === 'guided') {
        setPhase((p) => (p === 'accessibility_done' || p === 'accessibility' ? 'screenRecording' : p))
      }
    })
  }, [flow])

  useEffect(() => {
    const ax = status.accessibility === 'granted'
    const screen = status.screenRecording === 'granted'

    if (flow === 'single') {
      const pane = boot.pane
      const granted = pane === 'accessibility' ? ax : screen
      if (granted) setPhase('done')
      return
    }

    // guided
    if (ax && screen) {
      setPhase('done')
      return
    }
    if (ax) {
      setPhase((prev) => {
        if (prev === 'accessibility') return 'accessibility_done'
        return prev
      })
    }
  }, [status.accessibility, status.screenRecording, flow, boot.pane])

  function finishFileDrag() {
    setDragEpoch((n) => n + 1)
  }

  const canFileDrag =
    Boolean(helperPath)
    && (phase === 'accessibility' || phase === 'screenRecording')

  function handleIconDragStart(event: DragEvent<HTMLDivElement>) {
    if (!canFileDrag) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    event.stopPropagation()

    const icon = dragIconRef.current
    if (icon) {
      const copy = icon.bytes.slice()
      window.app.startDrag([helperPath], {
        png: copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
        scaleFactor: icon.scaleFactor,
      })
    } else {
      window.app.startDrag([helperPath])
    }

    const cleanup = (): void => {
      finishFileDrag()
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('dragend', cleanup)
  }

  function handleClose(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    void window.app.closeComputerUsePermissionFloat()
  }

  function handleContinue(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setPhase('screenRecording')
    void window.app.continueComputerUsePermissionStep()
  }

  async function handleRecheck(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (recheckBusy) return
    setRecheckBusy(true)
    setRecheckHint(null)
    try {
      const result = await window.app.recheckComputerUsePermissions()
      if (result.error) {
        setRecheckHint(result.error)
        return
      }
      setStatus((prev) => ({
        ...prev,
        accessibility: result.accessibility ?? prev.accessibility,
        screenRecording: result.screenRecording ?? prev.screenRecording,
        helperName: result.helperName ?? prev.helperName,
        helperBundleId: result.helperBundleId ?? prev.helperBundleId,
        helperPath: result.helperPath ?? prev.helperPath,
      }))
      const axOk = result.accessibility === 'granted'
      const screenOk = result.screenRecording === 'granted'
      if (flow === 'single') {
        const granted = boot.pane === 'accessibility' ? axOk : screenOk
        if (granted) setPhase('done')
        else {
          setRecheckHint(
            t('settings.computerUse.permissions.recheckStillMissing', { helperName }),
          )
        }
        return
      }
      if (axOk && screenOk) {
        setPhase('done')
      } else if (axOk && phase === 'accessibility') {
        setPhase('accessibility_done')
      } else {
        setRecheckHint(
          t('settings.computerUse.permissions.recheckStillMissing', { helperName }),
        )
      }
    } catch (err) {
      setRecheckHint(err instanceof Error ? err.message : String(err))
    } finally {
      setRecheckBusy(false)
    }
  }

  const stepLabel = useMemo(() => {
    switch (phase) {
      case 'accessibility':
        return t('settings.computerUse.permissions.stepAccessibility')
      case 'accessibility_done':
        return t('settings.computerUse.permissions.accessibilityGranted')
      case 'screenRecording':
        return t('settings.computerUse.permissions.stepScreenRecording')
      case 'done':
        return flow === 'single'
          ? boot.pane === 'accessibility'
            ? t('settings.computerUse.permissions.accessibilityGranted')
            : t('settings.computerUse.permissions.screenRecordingGranted')
          : t('settings.computerUse.permissions.alreadyGranted')
    }
  }, [phase, flow, boot.pane, t])

  const hint = useMemo(() => {
    switch (phase) {
      case 'accessibility':
        return t('settings.computerUse.permissions.dragHintAccessibility')
      case 'accessibility_done':
        return t('settings.computerUse.permissions.accessibilityGrantedHint')
      case 'screenRecording':
        return t('settings.computerUse.permissions.dragHintScreenRecording')
      case 'done':
        return flow === 'single'
          ? boot.pane === 'accessibility'
            ? t('settings.computerUse.permissions.accessibilityGranted')
            : t('settings.computerUse.permissions.screenRecordingGranted')
          : t('settings.computerUse.permissions.allGrantedHint')
    }
  }, [phase, flow, boot.pane, t])

  const showSuccess = phase === 'accessibility_done' || phase === 'done'
  const rootRef = useRef<HTMLDivElement>(null)

  // Size the BrowserWindow to the card content (no fixed shell height).
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void => {
      const rect = el.getBoundingClientRect()
      // Electron setContentSize uses CSS/DIP pixels (same as getBoundingClientRect).
      void window.app.resizeComputerUsePermissionFloat(
        Math.ceil(rect.width),
        Math.ceil(rect.height),
      )
    }
    report()
    const ro = new ResizeObserver(() => report())
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase, stepLabel, hint])

  /** Simple horizontal ▶ row; wave starts at the icon and runs outward. */
  const flatChevrons = (side: 'left' | 'right') => (
    <div className="flex items-center gap-0.5" aria-hidden="true" style={dragRegion}>
      {[0, 1, 2, 3].map((i) => {
        // left: index 3 is next to icon → delay 0; right: index 0 next to icon
        const fromCenter = side === 'left' ? 3 - i : i
        return (
          <span
            key={i}
            className="inline-block size-0 border-y-[4px] border-y-transparent border-l-[7px] border-l-sky-300"
            style={{
              ...dragRegion,
              opacity: 0.35 + fromCenter * 0.2,
              animation: 'cu-chevron-nudge-right 0.9s ease-in-out infinite',
              animationDelay: `${fromCenter * 120}ms`,
            }}
          />
        )
      })}
    </div>
  )

  // Layout: 1) title  2) arrows + icon + bend-up arrows  3) hint  (+ action when needed)
  return (
    <div
      ref={rootRef}
      className={cn(
        'box-border flex w-[300px] flex-col gap-2 rounded-2xl',
        'border border-white/15 bg-zinc-900 px-4 py-3.5 text-white shadow-xl',
      )}
      style={dragRegion}
    >
      {/* Row 1: title + close */}
      <div className="flex items-start gap-1.5" style={dragRegion}>
        <div className="min-w-0 flex-1" style={dragRegion}>
          <p className="truncate text-xs font-semibold tracking-tight text-white">
            {helperName}
          </p>
          {status.helperBundleId && (
            <p className="truncate font-mono text-[9px] text-white/55" title={status.helperBundleId}>
              {status.helperBundleId}
            </p>
          )}
          <p
            className={cn(
              'mt-0.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide',
              showSuccess ? 'text-emerald-300/95' : 'text-sky-300/90',
            )}
          >
            {showSuccess && <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">{stepLabel}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={handleClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md p-0.5 text-white/55 hover:bg-white/10 hover:text-white"
          style={noDragRegion}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Row 2: ▶▶▶▶ icon ▶▶▶▶ (flat, wave from center outward) */}
      <div className="mt-1.5 flex items-center justify-center gap-1.5" style={dragRegion}>
        {canFileDrag ? (
          <>
            {flatChevrons('left')}
            <div
              key={dragEpoch}
              draggable
              onDragStart={handleIconDragStart}
              title={hint}
              className="relative shrink-0 cursor-grab rounded-xl border-2 border-dashed border-sky-300/55 bg-black/30 p-1 active:cursor-grabbing"
              style={noDragRegion}
            >
              <div className="relative size-12 overflow-hidden rounded-[22%]">
                <img
                  src={computerUseBaseplate}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 size-full"
                />
                <img
                  src={computerUseCursor}
                  alt=""
                  draggable={false}
                  className="absolute left-1/2 top-1/2 size-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-sm"
                />
              </div>
            </div>
            {flatChevrons('right')}
          </>
        ) : (
          <CheckCircle2 className="size-12 text-emerald-400" aria-hidden="true" />
        )}
      </div>

      {/* Row 3: hint */}
      <p className="text-center text-[10px] font-medium leading-snug text-white/85" style={dragRegion}>
        {hint}
      </p>

      {helperPath && (
        <p
          className="truncate border-t border-white/10 pt-1.5 font-mono text-[9px] text-white/50"
          title={helperPath}
          style={dragRegion}
        >
          {helperPath}
        </p>
      )}

      {recheckHint && phase !== 'done' && phase !== 'accessibility_done' && (
        <p className="text-center text-[9px] leading-snug text-amber-200/90" style={dragRegion}>
          {recheckHint}
        </p>
      )}

      {/* Recheck restarts the helper — only useful for Screen Recording sticky TCC. */}
      {phase === 'screenRecording' && (
        <button
          type="button"
          onClick={(e) => void handleRecheck(e)}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={recheckBusy}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-semibold text-white/90 shadow hover:bg-white/15 disabled:opacity-50"
          style={noDragRegion}
        >
          {recheckBusy
            ? t('settings.computerUse.permissions.rechecking')
            : t('settings.computerUse.permissions.recheck')}
        </button>
      )}

      {phase === 'accessibility_done' && flow === 'guided' && (
        <button
          type="button"
          onClick={handleContinue}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-full rounded-lg bg-sky-500 px-2 py-1 text-[10px] font-semibold text-white shadow hover:bg-sky-400 active:bg-sky-600"
          style={noDragRegion}
        >
          {t('settings.computerUse.permissions.continueToScreenRecording')}
        </button>
      )}

      {phase === 'done' && (
        <button
          type="button"
          onClick={handleClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-full rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white shadow hover:bg-emerald-400 active:bg-emerald-600"
          style={noDragRegion}
        >
          {t('settings.computerUse.permissions.done')}
        </button>
      )}

      <style>{`
        @keyframes cu-chevron-nudge-right {
          0%, 100% { transform: translateX(0); opacity: 0.75; }
          50% { transform: translateX(3px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
