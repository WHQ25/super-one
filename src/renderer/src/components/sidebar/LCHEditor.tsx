import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  clampA,
  clampC,
  clampHue,
  clampL,
  type LCH,
  type LCHPartial,
} from '../../../../shared/harness-brand'

const MAX_CHROMA = 0.37
const CANVAS_W = 288
const CANVAS_H = 192
const HUE_STRIP_HEIGHT = 14
const ALPHA_STRIP_HEIGHT = 14
const HUE_STRIP_STEPS = 36
const GAMUT_BINARY_ITERS = 14
const GAMUT_SAMPLES = 192
const SRGB_LUT_SIZE = 4096

const srgbLut = (() => {
  const lut = new Uint8Array(SRGB_LUT_SIZE)
  for (let i = 0; i < SRGB_LUT_SIZE; i++) {
    const linear = i / (SRGB_LUT_SIZE - 1)
    const sRGB = linear < 0.0031308
      ? 12.92 * linear
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
    lut[i] = Math.max(0, Math.min(255, (sRGB * 255) | 0))
  }
  return lut
})()

function srgbFromLinear(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 255
  return srgbLut[(v * (SRGB_LUT_SIZE - 1)) | 0]
}

function findGamutEdgeC(l: number, cosH: number, sinH: number): number {
  let lo = 0
  let hi = MAX_CHROMA
  for (let i = 0; i < GAMUT_BINARY_ITERS; i++) {
    const mid = (lo + hi) / 2
    const a = mid * cosH
    const b = mid * sinH
    const lp = l + 0.3963377774 * a + 0.2158037573 * b
    const mp = l - 0.1055613458 * a - 0.0638541728 * b
    const sp = l - 0.0894841775 * a - 1.291485548 * b
    const ll = lp * lp * lp
    const mm = mp * mp * mp
    const ss = sp * sp * sp
    const r = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
    const g = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
    const bl = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss
    if (r >= 0 && r <= 1 && g >= 0 && g <= 1 && bl >= 0 && bl <= 1) lo = mid
    else hi = mid
  }
  return lo
}

function renderLCArea(
  canvas: HTMLCanvasElement,
  imgRef: React.RefObject<ImageData | null>,
  hue: number,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  let img = imgRef.current
  if (!img || img.width !== w || img.height !== h) {
    img = ctx.createImageData(w, h)
    imgRef.current = img
  }
  const data = img.data

  const hRad = (hue * Math.PI) / 180
  const cosH = Math.cos(hRad)
  const sinH = Math.sin(hRad)

  for (let y = 0; y < h; y++) {
    const L = 1 - y / (h - 1)
    for (let x = 0; x < w; x++) {
      const c = (x / (w - 1)) * MAX_CHROMA
      const a = c * cosH
      const b = c * sinH

      const lp = L + 0.3963377774 * a + 0.2158037573 * b
      const mp = L - 0.1055613458 * a - 0.0638541728 * b
      const sp = L - 0.0894841775 * a - 1.291485548 * b

      const ll = lp * lp * lp
      const mm = mp * mp * mp
      const ss = sp * sp * sp

      const rLin = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
      const gLin = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
      const bLin = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss

      const idx = (y * w + x) * 4
      data[idx] = srgbFromLinear(rLin)
      data[idx + 1] = srgbFromLinear(gLin)
      data[idx + 2] = srgbFromLinear(bLin)
      data[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function chaikinSmooth(points: Array<[number, number]>, iterations: number): Array<[number, number]> {
  let pts = points
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break
    const next: Array<[number, number]> = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]
      const [x1, y1] = pts[i + 1]
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25])
      next.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75])
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts
}

function computeGamutPath(hue: number): string {
  const hRad = (hue * Math.PI) / 180
  const cosH = Math.cos(hRad)
  const sinH = Math.sin(hRad)

  const raw: Array<[number, number]> = []
  for (let i = 0; i <= GAMUT_SAMPLES; i++) {
    const yRatio = i / GAMUT_SAMPLES
    const L = 1 - yRatio
    const edgeC = findGamutEdgeC(L, cosH, sinH)
    const x = (edgeC / MAX_CHROMA) * 100
    const y = yRatio * 100
    raw.push([x, y])
  }

  const points = chaikinSmooth(raw, 3)

  if (points.length < 2) return ''
  let d = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`
  }
  return d
}

interface LCHEditorProps {
  lch: LCH
  onChange: (partial: LCHPartial) => void
}

const HUE_STRIP_GRADIENT = (() => {
  const stops: string[] = []
  for (let i = 0; i <= HUE_STRIP_STEPS; i++) {
    const h = (i / HUE_STRIP_STEPS) * 360
    stops.push(`oklch(0.7 0.13 ${h})`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
})()

const CHECKER_BG = `
  linear-gradient(45deg, #ccc 25%, transparent 25%),
  linear-gradient(-45deg, #ccc 25%, transparent 25%),
  linear-gradient(45deg, transparent 75%, #ccc 75%),
  linear-gradient(-45deg, transparent 75%, #ccc 75%)
`
const CHECKER_BG_SIZE = '10px 10px'
const CHECKER_BG_POSITION = '0 0, 0 5px, 5px -5px, -5px 0'

function isInGamutOklch(l: number, c: number, h: number): boolean {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)
  const lp = l + 0.3963377774 * a + 0.2158037573 * b
  const mp = l - 0.1055613458 * a - 0.0638541728 * b
  const sp = l - 0.0894841775 * a - 1.291485548 * b
  const ll = lp * lp * lp
  const mm = mp * mp * mp
  const ss = sp * sp * sp
  const r = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
  const g = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
  const bl = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss
  return r >= 0 && r <= 1 && g >= 0 && g <= 1 && bl >= 0 && bl <= 1
}

interface DragHandlers {
  onPointerDown: (e: React.PointerEvent) => void
}

function useAreaDrag(
  ref: React.RefObject<HTMLDivElement | null>,
  onMove: (xRatio: number, yRatio: number) => void,
): DragHandlers {
  const draggingRef = useRef(false)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const update = useCallback((clientX: number, clientY: number) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const xRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const yRatio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    onMoveRef.current(xRatio, yRatio)
  }, [ref])

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      update(e.clientX, e.clientY)
    }
    const handleUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [update])

  return {
    onPointerDown: (e) => {
      draggingRef.current = true
      update(e.clientX, e.clientY)
    },
  }
}

function NumericInput({
  label,
  value,
  step,
  min,
  max,
  digits,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  digits: number
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState(value.toFixed(digits))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused) return
    setDraft(value.toFixed(digits))
  }, [value, digits, focused])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDraft(raw)
    if (raw === '' || raw === '-' || raw === '.') return
    const n = Number(raw)
    if (Number.isFinite(n)) {
      onChange(Math.max(min, Math.min(max, n)))
    }
  }

  return (
    <label className="flex flex-1 flex-col gap-1 min-w-0">
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="h-6 px-1 py-0 text-center font-mono text-[10px] tabular-nums"
      />
    </label>
  )
}

export function LCHEditor({ lch, onChange }: LCHEditorProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const alphaRef = useRef<HTMLDivElement>(null)
  const imageDataRef = useRef<ImageData | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    let raf: number | null = requestAnimationFrame(() => {
      raf = null
      renderLCArea(canvas, imageDataRef, lch.h)
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [lch.h])

  const gamutPath = useMemo(() => computeGamutPath(lch.h), [lch.h])

  const areaDrag = useAreaDrag(areaRef, (xRatio, yRatio) => {
    onChange({
      l: clampL(1 - yRatio),
      c: clampC(xRatio * MAX_CHROMA),
    })
  })

  const hueDrag = useAreaDrag(hueRef, (xRatio) => {
    onChange({ h: clampHue(xRatio * 360) })
  })

  const alphaDrag = useAreaDrag(alphaRef, (xRatio) => {
    onChange({ a: clampA(xRatio) })
  })

  const handleLeft = (lch.c / MAX_CHROMA) * 100
  const handleTop = (1 - lch.l) * 100
  const hueLeft = (lch.h / 360) * 100
  const alphaLeft = lch.a * 100
  const inGamut = isInGamutOklch(lch.l, lch.c, lch.h)
  const opaquePreviewCss = `oklch(${lch.l} ${lch.c} ${lch.h})`
  const previewCss = lch.a < 1
    ? `oklch(${lch.l} ${lch.c} ${lch.h} / ${lch.a})`
    : opaquePreviewCss

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={areaRef}
        onPointerDown={areaDrag.onPointerDown}
        className="relative aspect-[3/2] w-full overflow-hidden rounded-md border border-border touch-none select-none cursor-crosshair"
      >
        <canvas ref={canvasRef} className="size-full" />
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path
            d={gamutPath}
            fill="none"
            stroke="rgba(0, 0, 0, 0.45)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={gamutPath}
            fill="none"
            stroke="#ffffff"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/40"
          style={{ left: `${handleLeft}%`, top: `${handleTop}%` }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={hueDrag.onPointerDown}
        className="relative w-full overflow-hidden rounded-full border border-border touch-none select-none cursor-pointer"
        style={{ height: HUE_STRIP_HEIGHT, background: HUE_STRIP_GRADIENT }}
      >
        <div
          className="pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/40"
          style={{ left: `${hueLeft}%` }}
        />
      </div>

      <div
        ref={alphaRef}
        onPointerDown={alphaDrag.onPointerDown}
        className="relative w-full overflow-hidden rounded-full border border-border touch-none select-none cursor-pointer"
        style={{
          height: ALPHA_STRIP_HEIGHT,
          backgroundColor: '#fff',
          backgroundImage: CHECKER_BG,
          backgroundSize: CHECKER_BG_SIZE,
          backgroundPosition: CHECKER_BG_POSITION,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(to right, transparent, ${opaquePreviewCss})` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/40"
          style={{ left: `${alphaLeft}%` }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="size-9 shrink-0 overflow-hidden rounded-md border border-border"
          style={{
            backgroundColor: '#fff',
            backgroundImage: CHECKER_BG,
            backgroundSize: CHECKER_BG_SIZE,
            backgroundPosition: CHECKER_BG_POSITION,
          }}
        >
          <div className="size-full" style={{ background: previewCss }} />
        </div>
        <NumericInput
          label="L"
          value={lch.l}
          step={0.005}
          min={0}
          max={1}
          digits={3}
          onChange={(l) => onChange({ l })}
        />
        <NumericInput
          label="C"
          value={lch.c}
          step={0.005}
          min={0}
          max={MAX_CHROMA}
          digits={3}
          onChange={(c) => onChange({ c })}
        />
        <NumericInput
          label="H"
          value={lch.h}
          step={1}
          min={0}
          max={360}
          digits={0}
          onChange={(h) => onChange({ h })}
        />
        <NumericInput
          label="A"
          value={lch.a}
          step={0.01}
          min={0}
          max={1}
          digits={2}
          onChange={(a) => onChange({ a })}
        />
      </div>

      <p
        className={cn(
          '-my-1.5 text-[10px] leading-tight text-amber-600 dark:text-amber-400',
          inGamut && 'invisible',
        )}
        aria-hidden={inGamut}
      >
        ⚠ Out of sRGB gamut — display will clip the color
      </p>
    </div>
  )
}
