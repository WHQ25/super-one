import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { useIsDark } from '@/hooks/use-is-dark'
import { STICKY_PALETTE, stickyForIndex, type StickySwatch } from './plan-sticky-palette'
import {
  MARKER_OVERSHOOT,
  StickyPaper,
  StickyPinFace,
  markerStrokeStyle,
  strokeSeed,
} from './plan-sticky-visuals'

/**
 * Visual reference for plan comment annotations: chisel-tip marker strokes and
 * 3M Post-it notes, sharing one palette. Flip the Storybook **Theme** toolbar —
 * the stroke switches from `multiply` (light) to `screen` (dark) ink.
 */
const meta: Meta = {
  title: 'ClaudeCode/PlanStickyNotes',
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** Text with a marker stroke painted over it, exactly as PlanLineReview does. */
function Marked({
  children,
  swatch,
  seed = 1,
}: {
  children: ReactNode
  swatch: StickySwatch
  seed?: number
}) {
  const isDark = useIsDark()
  return (
    <span className="relative inline-block">
      {children}
      {/* PlanLineReview centres each stroke on the line box — mirror that here */}
      <span
        aria-hidden
        className="pointer-events-none absolute z-[1]"
        style={{
          top: '50%',
          marginTop: '-0.55em',
          left: -MARKER_OVERSHOOT,
          right: -MARKER_OVERSHOOT,
          height: '1.1em',
          ...markerStrokeStyle(swatch, isDark, strokeSeed('story', seed)),
        }}
      />
    </span>
  )
}

function Pin({ index }: { index: number }) {
  const isDark = useIsDark()
  return (
    <span
      className="inline-flex align-middle"
      style={{
        transform: `rotate(${index % 2 === 0 ? -3 : 2.5}deg)`,
        filter: `drop-shadow(1px 1.5px 1.5px rgb(0 0 0 / ${isDark ? 0.5 : 0.28}))`,
      }}
    >
      <StickyPinFace swatch={stickyForIndex(index)} isDark={isDark} index={index} />
    </span>
  )
}

function Note({
  swatch,
  rotate,
  size = 196,
  children,
}: {
  swatch: StickySwatch
  rotate?: number
  size?: number
  children?: ReactNode
}) {
  const isDark = useIsDark()
  const scale = size / 196
  return (
    <StickyPaper
      swatch={swatch}
      isDark={isDark}
      rotate={rotate}
      width={size}
      minHeight={Math.round(184 * scale)}
    >
      <div
        className="leading-relaxed"
        style={{
          padding: `${Math.round(24 * scale)}px ${Math.round(16 * scale)}px ${Math.round(20 * scale)}px`,
          fontSize: 13 * scale,
          color: swatch.text,
        }}
      >
        {children}
      </div>
    </StickyPaper>
  )
}

/** All six colors: paper, marker stroke and collapsed pin side by side. */
export const Palette: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {STICKY_PALETTE.map((swatch, i) => (
        <div key={swatch.id} className="flex items-center gap-6">
          <div className="w-36 shrink-0">
            <div className="text-sm font-medium">{swatch.label}</div>
            <div className="text-muted-foreground font-mono text-[11px]">{swatch.id}</div>
          </div>
          <Pin index={i} />
          <div className="w-[300px] shrink-0 whitespace-nowrap text-[15px] leading-8">
            <Marked swatch={swatch} seed={i}>
              highlighted with this marker
            </Marked>
          </div>
          <Note swatch={swatch} size={92} rotate={i % 2 === 0 ? -1.4 : 1.6} />
        </div>
      ))}
    </div>
  ),
}

/** Strokes over prose: overlapping ink, inline code, multi-line runs. */
export const MarkerStrokes: Story = {
  render: () => (
    <div className="max-w-[620px] text-[15px] leading-8">
      <p>
        Audit every direct caller of{' '}
        <Marked swatch={stickyForIndex(0)} seed={11}>
          <code className="bg-muted rounded px-1 py-0.5 text-[13px]">Session.send()</code>
        </Marked>{' '}
        before moving the guard, then{' '}
        <Marked swatch={stickyForIndex(1)} seed={12}>
          collapse the duplicated lock checks
        </Marked>{' '}
        that are scattered through the IPC handlers.
      </p>
      {/* A wrapped selection is painted as one stroke per visual line, like here */}
      <p className="mt-4">
        <Marked swatch={stickyForIndex(3)} seed={13}>
          A selection that wraps gets one stroke per visual line,
        </Marked>
        <br />
        <Marked swatch={stickyForIndex(3)} seed={14}>
          with the pen dwelling a little at every start and stop.
        </Marked>
      </p>
      <p className="mt-4">
        Overlapping ink darkens naturally:{' '}
        <Marked swatch={stickyForIndex(4)} seed={14}>
          <Marked swatch={stickyForIndex(5)} seed={15}>
            two strokes crossing
          </Marked>
        </Marked>{' '}
        the same words.
      </p>
    </div>
  ),
}

/** Notes fanned out like a real desk. */
export const StickyNotes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-10 p-6">
      {STICKY_PALETTE.map((swatch, i) => (
        <Note key={swatch.id} swatch={swatch} rotate={[-2.4, 1.6, -1, 2.2, -1.8, 1.1][i]}>
          {
            [
              'Split the IPC cleanup into its own follow-up PR.',
              'Add a regression test for the locked-send path.',
              'Does this cover the remote owner case?',
              'Keep the guard inside Session, not in handlers.',
              'Check the mobile subscriber list here.',
              'Rename before merging — this is confusing.',
            ][i]
          }
        </Note>
      ))}
    </div>
  ),
}

/** How a reviewed plan actually looks: strokes + numbered pins + one open note. */
export const PlanUnderReview: Story = {
  render: () => (
    <div className="relative max-w-[640px]">
      <h3 className="mb-3 text-base font-semibold">Plan</h3>
      <ol className="list-decimal space-y-3 pl-5 text-[15px] leading-8">
        <li>
          <Marked swatch={stickyForIndex(0)} seed={21}>
            Audit existing usage of Session.send() to find direct callers.
          </Marked>
          <Pin index={0} />
        </li>
        <li>
          Add an{' '}
          <Marked swatch={stickyForIndex(1)} seed={22}>
            ownership guard inside Session.send()
          </Marked>{' '}
          itself.
          <Pin index={1} />
        </li>
        <li>
          Remove duplicated lock checks scattered through IPC handlers.
        </li>
        <li>
          <Marked swatch={stickyForIndex(2)} seed={23}>
            Add an integration test covering the locked-send rejection path.
          </Marked>
          <Pin index={2} />
        </li>
      </ol>
      <div className="mt-8 flex gap-8">
        <Note swatch={stickyForIndex(1)} rotate={1.2}>
          Guard belongs in Session — handlers keep drifting.
        </Note>
        <Note swatch={stickyForIndex(2)} rotate={-1.6}>
          Cover the remote-owner case too.
        </Note>
      </div>
    </div>
  ),
}
