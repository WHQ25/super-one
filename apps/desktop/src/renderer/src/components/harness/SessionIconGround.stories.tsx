import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { ComponentType } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { cn } from '@superone/ui/lib/utils'
import { AcpSessionIcon } from '@superone/ui/components/harness/AcpSessionIcon'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import { CursorSessionIcon } from '@superone/ui/components/harness/CursorSessionIcon'
import { DeepseekSessionIcon } from '@superone/ui/components/harness/DeepseekSessionIcon'
import { GrokSessionIcon } from '@superone/ui/components/harness/GrokSessionIcon'
import { OpenCodeSessionIcon } from '@superone/ui/components/harness/OpenCodeSessionIcon'
import { useAppStore } from '@/stores/app'
import { useActiveHarness } from '@/hooks/useHarnessTheme'
import {
  HARNESS_DEFAULT_BRAND_HUE,
  contrastRatio,
  inkForFill,
  lchToCss,
  maxChromaInSRGB,
  resolveTokenLCH,
} from '@superone/shared/harness-brand'
import type { LCHPartial } from '@superone/shared/harness-brand'
import { resolveSessionIcon } from './resolve-session-icon'
import type { SessionIconProps } from './resolve-session-icon'

/**
 * Bench for separating a harness mark from the row surface under it.
 *
 * Deliberately a swatch matrix and not a mock sidebar: the only thing that
 * decides the outcome is the colour immediately behind the glyph, so the bench
 * reproduces those three surfaces exactly and nothing else. It still paints them
 * through the real tokens inside a real `[data-sidebar-inner]` scope, because
 * both of those change the answer —
 *   • the scope remaps `--foreground` to `--sidebar-foreground`, which is the
 *     only reason Cursor / OpenCode / Grok are light marks at all;
 *   • Liquid Glass drops `--sidebar` to alpha 0.80 over the desktop and turns
 *     `--sidebar-hover` into a WHITE overlay, so a treatment tuned against the
 *     opaque L 0.26 is being tuned against a surface the user never sees.
 */

type IconComponent = ComponentType<SessionIconProps>

function grounded(harnessId: string, acpAgentId?: string): IconComponent {
  const Icon = resolveSessionIcon(harnessId, acpAgentId)
  if (!Icon) throw new Error(`no session icon for ${harnessId}`)
  return Icon
}

/** Titles are the real thing, not `Lorem`: a mark is never seen alone, and the
 *  label beside it is what the eye actually anchors on. Truncation matters too —
 *  the row is 190px here, the same order as the app's 320px sidebar minus its
 *  chrome. */
const HARNESSES: { label: string; title: string; Ground: IconComponent; Bare: IconComponent }[] = [
  { label: 'Claude', title: 'Fix sidebar hover blob', Ground: grounded('claude'), Bare: ClaudeSessionIcon },
  { label: 'Codex', title: 'Refactor session store', Ground: grounded('codex'), Bare: CodexSessionIcon },
  { label: 'Cursor', title: 'Add worktree cleanup test', Ground: grounded('cursor'), Bare: CursorSessionIcon },
  { label: 'DeepSeek', title: 'Port relay ACK protocol', Ground: grounded('dsh'), Bare: DeepseekSessionIcon },
  { label: 'OpenCode', title: 'Bump harness manifest', Ground: grounded('opencode'), Bare: OpenCodeSessionIcon },
  { label: 'Grok', title: 'Investigate stalled turn', Ground: grounded('acp', 'grok-build'), Bare: GrokSessionIcon },
  { label: 'ACP', title: 'Wire device catalog tiers', Ground: grounded('acp'), Bare: AcpSessionIcon },
]

const STATUSES: SessionIconProps['status'][] = ['default', 'running', 'background', 'unseen', 'automation']

/** The three surfaces a session row can paint, in the app's own class terms. */
const SURFACES = [
  { id: 'selected', label: 'selected', cls: 'bg-sidebar-accent sidebar-selected' },
  { id: 'resting', label: 'resting', cls: '' },
  { id: 'hover', label: 'hover', cls: 'bg-sidebar-hover' },
] as const

const VARIANTS = [
  { id: 'outline', label: 'mark outline' },
  { id: 'fade', label: 'fade disc' },
  { id: 'chip', label: 'squircle chip' },
  { id: 'deep', label: 'deepen fill' },
  { id: 'off', label: 'nothing' },
] as const

type VariantId = (typeof VARIANTS)[number]['id']

const SIDEBAR_FILL =
  'oklch(var(--sidebar-l, 0.26) var(--sidebar-c, 0.02) var(--sidebar-h, var(--brand-hue, 240)))'

/**
 * The outline ink is derived from the fill it has to separate from, so it tracks
 * any brand hue and any palette override. `color-mix` toward black in oklab
 * drops lightness and chroma together, which also means it can never ask for
 * more chroma than the fill already proved reachable in sRGB.
 *
 * 40 is the ceiling: the deepest mix at which every mark still clears 3:1
 * (tightest is Codex, 3.35:1 on hue 40 / 3.26:1 on hue 240). 45 drops it to 2.99.
 */
const outlineInk = (depth: number) =>
  `color-mix(in oklab, var(--sidebar-accent) ${depth}%, black)`

interface Knobs {
  variant: VariantId
  inset: number
  darken: number
  outlineDepth: number
  outlineAlpha: number
  outlineBlur: number
  outlineLayers: number
}

/** Overrides the SHIPPING selector in place, so the bench measures the real rule. */
function overrideCss(v: Knobs): string {
  const scope = `.ground-bench[data-ground='${v.variant}'] [data-sidebar-inner]`
  const before = `${scope} .sidebar-selected .session-icon-ground::before`
  const noGround = `${before} { content: none; }`
  const fill = v.darken === 0 ? SIDEBAR_FILL : `color-mix(in oklab, ${SIDEBAR_FILL} ${100 - v.darken}%, black)`

  switch (v.variant) {
    case 'off':
      return noGround
    case 'chip':
      return `${before} { inset: -${v.inset}%; border-radius: 32%; background: ${fill}; }`
    case 'deep':
      return `${noGround}
${scope} .sidebar-selected {
  background-color: color-mix(in oklab, var(--sidebar-accent) ${100 - Math.max(v.darken, 1) * 1.4}%, black);
}`
    case 'outline': {
      const base = outlineInk(v.outlineDepth)
      const ink = v.outlineAlpha >= 100 ? base : `color-mix(in oklab, ${base} ${v.outlineAlpha}%, transparent)`
      const shadow = `drop-shadow(0 0 ${v.outlineBlur}px ${ink})`
      return `${noGround}
${scope} .sidebar-selected .session-icon-ground {
  filter: ${Array.from({ length: v.outlineLayers }, () => shadow).join(' ')};
}`
    }
    default:
      return `${before} {
  inset: -${v.inset}%;
  background: radial-gradient(
    circle at 50% 50%,
    ${fill} 0%,
    ${fill} 52%,
    color-mix(in oklab, ${fill} 55%, transparent) 76%,
    color-mix(in oklab, ${fill} 0%, transparent) 100%
  );
}`
  }
}

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-28 accent-[var(--primary)]"
      />
      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums">{value}</span>
    </span>
  )
}

/** One cell pair in the control grid — the label column stays a single column so
 *  every control lines up regardless of what the variant exposes. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center">{children}</span>
    </>
  )
}

/** Live token values — the hue dial moves `--sidebar` by a real but tiny amount
 *  (chroma 0.020, "a whisper of the brand hue"), which is impossible to judge by
 *  eye against `--sidebar-accent` at chroma 0.148. */
function TokenReadout() {
  const ref = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<[string, string][]>([])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const read = () => {
      const cs = getComputedStyle(el)
      setRows([
        ['hue', getComputedStyle(document.documentElement).getPropertyValue('--brand-hue').trim()],
        ['--sidebar', cs.getPropertyValue('--sidebar').trim()],
        ['--sidebar-hover', cs.getPropertyValue('--sidebar-hover').trim()],
        ['--sidebar-accent', cs.getPropertyValue('--sidebar-accent').trim()],
      ])
      raf = requestAnimationFrame(read)
    }
    raf = requestAnimationFrame(read)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} data-sidebar-inner className="rounded-md bg-sidebar p-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 font-mono text-[10px] text-sidebar-foreground/80">
          <span className="w-24 shrink-0 text-sidebar-foreground/50">{k}</span>
          <span className="truncate">{v}</span>
        </div>
      ))}
    </div>
  )
}


/**
 * Live editor for `--sidebar-accent`, the selected-row fill.
 *
 * Writes through `tokenOverrides` — the same store slice the in-app palette
 * editor uses — rather than stamping a custom property on a wrapper. That is not
 * fastidiousness: `--color-sidebar-accent` is declared in `@theme inline` AT
 * `:root`, and a custom property's `var()` is substituted where it is DECLARED,
 * so an override set on any descendant is inherited as the already-resolved
 * colour and changes nothing. Going through the store makes `useHarnessTheme`
 * re-stamp the channels on `:root`, which is the only place the substitution can
 * still see them — and it means whatever you dial in here is expressible as a
 * real default in `buildHarnessDefaults`.
 */
function FillEditor() {
  const harness = useActiveHarness()
  const hue = useAppStore((s) => s.brandHues[harness]) ?? HARNESS_DEFAULT_BRAND_HUE[harness]
  const overrides = useAppStore((s) => s.tokenOverrides[harness])
  const override = overrides?.['--sidebar-accent']

  const fill = resolveTokenLCH(harness, '--sidebar-accent', override, hue)
  const ceiling = maxChromaInSRGB(fill.l, fill.h)
  const wantedInk = inkForFill(fill)
  // --sidebar-accent-foreground is NOT in useHarnessTheme's DERIVED_INK list, so
  // it does not follow the fill the way --primary-foreground does. Darken the
  // fill far enough and the row label keeps its dark ink and stops being read.
  const shippedInk = resolveTokenLCH(harness, '--sidebar-accent-foreground', overrides?.['--sidebar-accent-foreground'], hue)
  const labelContrast = contrastRatio(fill, shippedInk)

  const patch = (p: LCHPartial) =>
    useAppStore.setState((s) => ({
      tokenOverrides: {
        ...s.tokenOverrides,
        [harness]: {
          ...s.tokenOverrides[harness],
          '--sidebar-accent': { ...s.tokenOverrides[harness]?.['--sidebar-accent'], ...p },
        },
      },
    }))

  const reset = () =>
    useAppStore.setState((s) => {
      const next = { ...s.tokenOverrides[harness] }
      delete next['--sidebar-accent']
      return { tokenOverrides: { ...s.tokenOverrides, [harness]: next } }
    })

  // Leave the store as found — these overrides are global and would follow the
  // reader into every other story.
  useEffect(() => reset, [harness])

  return (
    <div className="w-fit space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="size-5 rounded border border-black/20" style={{ background: lchToCss(fill) }} />
        <code className="text-[11px]">{lchToCss(fill)}</code>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
        >
          reset
        </button>
      </div>

      <div className="grid grid-cols-[max-content_auto] items-center gap-x-4 gap-y-2">
        <Field label="fill L">
          <Slider label="fill L" value={Number(fill.l.toFixed(2))} min={0.35} max={0.95} step={0.01} onChange={(l) => patch({ l })} />
        </Field>
        <Field label="fill C">
          <Slider label="fill C" value={Number(fill.c.toFixed(3))} min={0} max={0.3} step={0.005} onChange={(c) => patch({ c })} />
        </Field>
      </div>

      <div className="space-y-0.5 text-[11px]">
        <div className={cn(fill.c > ceiling && 'text-warning')}>
          sRGB chroma ceiling at L {fill.l.toFixed(2)} / hue {Math.round(fill.h)}: {ceiling.toFixed(3)}
          {fill.c > ceiling && ' — over it, Chromium gamut-maps at paint time and shifts the hue'}
        </div>
        <div className={cn(labelContrast < 4.5 && 'text-warning')}>
          row label ink {labelContrast.toFixed(2)}:1
          {wantedInk.l !== shippedInk.l &&
            ` — inkForFill wants the ${wantedInk.l > 0.5 ? 'LIGHT' : 'DARK'} tone, but --sidebar-accent-foreground is not derived`}
        </div>
      </div>
    </div>
  )
}

function GroundBench() {
  const [variant, setVariant] = useState<VariantId>('outline')
  const [status, setStatus] = useState<SessionIconProps['status']>('default')
  const [size, setSize] = useState(0)
  const [surface, setSurface] = useState<(typeof SURFACES)[number]['id']>('selected')
  const [glass, setGlass] = useState(true)
  const [bare, setBare] = useState(false)
  const [inset, setInset] = useState(25)
  const [darken, setDarken] = useState(0)
  const [outlineDepth, setOutlineDepth] = useState(30)
  const [outlineAlpha, setOutlineAlpha] = useState(30)
  const [outlineBlur, setOutlineBlur] = useState(0.5)
  const [outlineLayers, setOutlineLayers] = useState(3)

  // The class is owned by useHarnessTheme, which re-runs whenever the hue dial
  // moves — driving the store is what keeps glass applied across those re-runs.
  useEffect(() => {
    useAppStore.setState({ liquidGlass: glass })
    return () => useAppStore.setState({ liquidGlass: false })
  }, [glass])

  const css = overrideCss({ variant, inset, darken, outlineDepth, outlineAlpha, outlineBlur, outlineLayers })
  const cell = size || 14
  const activeSurface = SURFACES.find((v) => v.id === surface) ?? SURFACES[0]

  return (
    <div className="ground-bench space-y-3 p-5 text-sm" data-ground={variant}>
      <style>{css}</style>

      <div className="w-fit space-y-3 rounded-md border border-border p-3">
        <div className="flex flex-wrap gap-1">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs',
                variant === v.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[max-content_auto_max-content_auto] items-center gap-x-4 gap-y-2">
          <Field label="Liquid Glass">
            <input type="checkbox" checked={glass} onChange={(e) => setGlass(e.target.checked)} />
          </Field>
          <Field label="bare (A/B)">
            <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} />
          </Field>
          <Field label="row state">
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value as (typeof SURFACES)[number]['id'])}
              className="rounded border border-border bg-background px-1.5 py-1 text-xs"
            >
              {SURFACES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SessionIconProps['status'])}
              className="rounded border border-border bg-background px-1.5 py-1 text-xs"
            >
              {STATUSES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="size">
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="rounded border border-border bg-background px-1.5 py-1 text-xs"
            >
              <option value={0}>14px</option>
              <option value={22}>22px</option>
              <option value={32}>32px</option>
            </select>
          </Field>

          {variant === 'outline' && (
            <>
              <Field label="ink">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-4 rounded-full border border-black/20"
                    style={{ background: outlineInk(outlineDepth) }}
                  />
                  <code className="text-[11px]">accent {outlineDepth}% + black</code>
                </span>
              </Field>
              <Field label="depth">
                <Slider label="depth" value={outlineDepth} min={10} max={70} step={1} onChange={setOutlineDepth} />
              </Field>
              <Field label="alpha">
                <Slider label="alpha" value={outlineAlpha} min={10} max={100} step={1} onChange={setOutlineAlpha} />
              </Field>
              <Field label="blur">
                <Slider label="blur" value={outlineBlur} min={0} max={4} step={0.5} onChange={setOutlineBlur} />
              </Field>
              <Field label="layers">
                <Slider label="layers" value={outlineLayers} min={1} max={5} step={1} onChange={setOutlineLayers} />
              </Field>
            </>
          )}
          {(variant === 'fade' || variant === 'chip') && (
            <>
              <Field label="inset">
                <Slider label="inset" value={inset} min={0} max={50} step={1} onChange={setInset} />
              </Field>
              <Field label="darken">
                <Slider label="darken" value={darken} min={0} max={40} step={1} onChange={setDarken} />
              </Field>
            </>
          )}
          {variant === 'deep' && (
            <Field label="darken">
              <Slider label="darken" value={darken} min={0} max={40} step={1} onChange={setDarken} />
            </Field>
          )}
        </div>

        {variant === 'outline' && outlineAlpha >= 100 && outlineDepth > 40 && (
          <p className="text-xs text-warning">
            opaque and deeper than 40% drops Codex below 3:1
          </p>
        )}
      </div>

      <FillEditor />

      {/* One row state at a time. Three panels side by side turned every
          comparison into a scan across two states that were not in question —
          only `selected` is ever short of contrast, and the other two are here
          to prove the rule stays out of them. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative w-fit rounded-md p-1">
          {glass && (
            <div
              aria-hidden
              className="absolute inset-0 rounded-md"
              style={{ background: 'linear-gradient(135deg, #6f7f9a 0%, #b9a892 35%, #8c6f7a 60%, #4b5a6e 100%)' }}
            />
          )}
          <div data-sidebar-inner className="relative w-[240px] rounded-md bg-sidebar p-2 text-sidebar-foreground">
            <div className="px-2.5 pb-2 text-[10px] uppercase tracking-wide text-sidebar-foreground/45">
              {activeSurface.label}
            </div>
            <div className="space-y-1.5">
              {HARNESSES.map((h) => {
                const Icon = bare ? h.Bare : h.Ground
                return (
                  <div
                    key={h.label}
                    className={cn(
                      // Same metrics as SessionRow: gap-2, rounded-md, px-2.5 py-1.5, 13px title.
                      'flex items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5',
                      activeSurface.cls,
                    )}
                  >
                    <span className="flex shrink-0 items-center justify-center">
                      <Icon status={status} active={surface === 'selected'} size={cell} renderLevel="compact" />
                    </span>
                    <span className="truncate text-[13px] text-sidebar-foreground">{h.title}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="w-64 space-y-2">
          <TokenReadout />
          {/* Off-sidebar surface the same marks reach through the same resolver —
              never brand-filled, so the rule is scoped out. This is the check
              that it stays out. */}
          <div className="rounded-md border border-border bg-popover p-2">
            <div className="pb-1 text-[10px] uppercase text-muted-foreground">popover (out of scope)</div>
            <div className="flex flex-wrap gap-2">
              {HARNESSES.map((h) => {
                const Icon = bare ? h.Bare : h.Ground
                return (
                  <span key={h.label} className="flex size-7 items-center justify-center rounded hover:bg-accent">
                    <Icon status={status} size={cell} renderLevel="compact" />
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <pre className="w-fit max-w-full overflow-x-auto rounded-md border border-border bg-muted p-2 text-[11px] leading-relaxed">
        {css.trim()}
      </pre>
    </div>
  )
}

const meta: Meta<typeof GroundBench> = {
  title: 'Harness/SessionIconGround',
  component: GroundBench,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof GroundBench>

export const Bench: Story = {}
