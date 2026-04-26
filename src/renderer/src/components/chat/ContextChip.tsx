import { X, Check, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useIsDark } from '@/hooks/use-is-dark'
import type { MiniAppContextSlot } from '@/stores/chat'

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) {
    const v = Math.round(l * 255)
    return `#${v.toString(16).padStart(2, '0').repeat(3)}`
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = Math.round(hue2rgb(p, q, h / 360 + 1 / 3) * 255)
  const g = Math.round(hue2rgb(p, q, h / 360) * 255)
  const b = Math.round(hue2rgb(p, q, h / 360 - 1 / 3) * 255)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function deriveColors(baseColor?: string, isDark = false) {
  const fallback = '#c4873a'
  const hex = baseColor && /^#[0-9a-fA-F]{6}$/.test(baseColor) ? baseColor : fallback
  const [h, s] = hexToHsl(hex)
  if (isDark) {
    return {
      bg: hslToHex(h, Math.min(s, 0.30), 0.22),
      color: hslToHex(h, Math.min(s, 0.55), 0.80),
      labelColor: hslToHex(h, Math.min(s, 0.40), 0.62),
      border: hslToHex(h, Math.min(s, 0.30), 0.32),
    }
  }
  return {
    bg: hslToHex(h, Math.min(s, 0.35), 0.93),
    color: hslToHex(h, Math.min(s, 0.5), 0.35),
    labelColor: hslToHex(h, Math.min(s, 0.4), 0.55),
    border: hslToHex(h, Math.min(s, 0.3), 0.82),
  }
}

interface ContextChipProps {
  slot: MiniAppContextSlot
  onToggle: () => void
  onDismiss: () => void
  onClick: () => void
}

export function ContextChip({ slot, onToggle, onDismiss, onClick }: ContextChipProps) {
  const isDark = useIsDark()
  const colors = deriveColors(slot.color, isDark)
  const isSuggest = slot.mode === 'suggest'
  const isActive = isSuggest ? slot.checked : true

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap select-none transition-opacity',
        !isActive && 'opacity-60',
      )}
      style={{
        background: isActive ? colors.bg : 'transparent',
        border: isSuggest && !isActive
          ? `1px dashed ${colors.border}`
          : `1px solid ${isActive ? colors.bg : 'transparent'}`,
      }}
    >
      <MiniAppIcon appId={slot.appId} className="size-3 shrink-0" />
      <button
        type="button"
        className="max-w-[140px] truncate font-medium cursor-pointer"
        style={{ color: colors.color }}
        onClick={onClick}
      >
        {slot.appName}
      </button>
      {slot.summary && (
        <>
          <span style={{ color: colors.labelColor, fontSize: 10 }}>·</span>
          <button
            type="button"
            className="max-w-[140px] truncate cursor-pointer"
            style={{ color: colors.labelColor, fontSize: 11 }}
            onClick={onClick}
          >
            {slot.summary}
          </button>
        </>
      )}
      {isSuggest ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          className="ml-0.5 cursor-pointer"
          style={{ color: colors.color }}
        >
          {slot.checked ? <Check className="size-3" /> : <Square className="size-3" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss() }}
          className="ml-0.5 cursor-pointer"
          style={{ color: colors.labelColor, opacity: 0.7 }}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  )
}

export function ContextPreviewContent({ appName, summary, content }: { appName: string; summary: string; content: string }) {
  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span>{appName}</span>
        {summary && <span className="text-muted-foreground">· {summary}</span>}
      </div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
        {content}
      </pre>
    </>
  )
}
