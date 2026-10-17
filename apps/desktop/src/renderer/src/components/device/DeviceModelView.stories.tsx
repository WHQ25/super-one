import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DeviceModelScreenPick } from '@superone/shared/device'
import { Button } from '@superone/ui/components/ui/button'
import {
  syntheticFoldableScene,
  syntheticPhoneScene,
  syntheticProScene,
  syntheticTabletScene,
} from './__fixtures__/synthetic-device-model'
import type { DeviceFrameProjector, NormalizedFramePoint } from './device-input'
import type { DeviceModelFold } from './device-model-renderer'
import { DeviceModelView, type DeviceModelSource } from './DeviceModelView'

type SceneName = 'phone' | 'pro' | 'tablet'

const scenes: Record<SceneName, () => DeviceModelSource['object']> = {
  phone: syntheticPhoneScene,
  pro: syntheticProScene,
  tablet: syntheticTabletScene,
}

/**
 * A stand-in guest: a clock ticking on a gradient, and a dot wherever the glass was
 * last touched — so dragging on the glass visibly lands where the pointer is, from
 * any angle the body is orbited to.
 */
function useGuestPicture(width: number, height: number) {
  const [canvas] = useState(() => {
    const element = document.createElement('canvas')
    element.width = width
    element.height = height
    return element
  })
  const listeners = useRef(new Set<() => void>())
  const touch = useRef<NormalizedFramePoint | null>(null)
  useEffect(() => {
    const context = canvas.getContext('2d')!
    const paint = () => {
      const gradient = context.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, '#1d4ed8')
      gradient.addColorStop(1, '#9333ea')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
      context.fillStyle = 'white'
      context.font = `600 ${Math.round(width / 8)}px system-ui`
      context.textAlign = 'center'
      context.fillText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), width / 2, height * 0.3)
      context.font = `${Math.round(width / 16)}px system-ui`
      context.fillText('Top', width / 2, height * 0.08)
      context.fillText('Bottom', width / 2, height * 0.95)
      if (touch.current) {
        context.beginPath()
        context.arc(touch.current.xRatio * width, touch.current.yRatio * height, width / 14, 0, Math.PI * 2)
        context.fill()
      }
      for (const listener of listeners.current) listener()
    }
    paint()
    const timer = setInterval(paint, 1000)
    return () => clearInterval(timer)
  }, [canvas, height, width])
  const subscribeFrames = (listener: () => void) => {
    listeners.current.add(listener)
    return () => { listeners.current.delete(listener) }
  }
  const touchAt = (point: NormalizedFramePoint | null) => {
    touch.current = point
    for (const listener of listeners.current) listener()
  }
  return { canvas, subscribeFrames, touchAt }
}

function Scenario({
  scene = 'phone',
  pick = 'only',
  rotationDegrees = 0,
  interactive = true,
  loadModel,
  width = 390,
  height = 844,
  fold = null,
}: {
  scene?: SceneName
  pick?: DeviceModelScreenPick
  rotationDegrees?: number
  interactive?: boolean
  loadModel?: (model: string) => Promise<DeviceModelSource | null>
  width?: number
  height?: number
  fold?: DeviceModelFold | null
}) {
  const guest = useGuestPicture(width, height)
  const projector = useRef<DeviceFrameProjector | null>(null)
  const [load] = useState(() => loadModel ?? (async () => ({ object: scenes[scene](), screen: pick })))
  const press = (event: React.PointerEvent) => {
    if (!interactive) return
    const point = projector.current?.point(event.clientX, event.clientY, false) ?? null
    if (point) guest.touchAt(point)
  }
  return (
    <DeviceModelView
      model="Synthetic"
      canvas={guest.canvas}
      subscribeFrames={guest.subscribeFrames}
      rotationDegrees={rotationDegrees}
      fold={fold}
      interactive={interactive}
      onProjector={(next) => { projector.current = next }}
      pointerHandlers={{ onPointerDown: press }}
      loadModel={load}
    />
  )
}

const FOLD_POSTURES: Record<'closed' | 'half opened' | 'opened' | 'tent', DeviceModelFold> = {
  'closed': { hingeDegrees: 0, panel: 'cover', panelRotation: 0 },
  'half opened': { hingeDegrees: 90, panel: 'inner', panelRotation: 90 },
  'opened': { hingeDegrees: 180, panel: 'inner', panelRotation: 90 },
  // Half open with the cover lit, and the device turned a quarter so the hinge is on top.
  'tent': { hingeDegrees: 60, panel: 'cover', panelRotation: 0 },
}
/** The device turn each posture is held at, beside the turn its panel is mounted at. */
const FOLD_TURNS: Partial<Record<keyof typeof FOLD_POSTURES, number>> = { tent: 90 }

const loadFoldable = async (): Promise<DeviceModelSource> => ({
  object: syntheticFoldableScene(),
  screen: 'largest',
  fold: { start: 0, duration: 1 },
})

/** Folds the way the device panel does: the host reports a posture, the body sweeps to it. */
function FoldableScenario({ initial }: { initial: keyof typeof FOLD_POSTURES }) {
  const [posture, setPosture] = useState(initial)
  const fold = FOLD_POSTURES[posture]
  return (
    <div className="flex size-full flex-col">
      <div className="flex gap-2 p-2">
        {Object.keys(FOLD_POSTURES).map((name) => (
          <Button
            key={name}
            size="sm"
            variant={name === posture ? 'default' : 'outline'}
            aria-pressed={name === posture}
            onClick={() => setPosture(name as keyof typeof FOLD_POSTURES)}
          >
            {name}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Scenario loadModel={loadFoldable} fold={fold} rotationDegrees={fold.panelRotation + (FOLD_TURNS[posture] ?? 0)}
          width={669} height={951} />
      </div>
    </div>
  )
}

const meta = {
  title: 'Device/DeviceModelView',
  component: Scenario,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-[560px] bg-background"><Story /></div>],
} satisfies Meta<typeof Scenario>
export default meta
type Story = StoryObj<typeof meta>

/** Drag the body to orbit; press the glass to drop a dot where the pointer is. */
export const Phone: Story = {}
export const Landscape: Story = { args: { rotationDegrees: 90 } }
/** Apple ships Pro and Pro Max in one scene; this is the larger one, cut out and stood up. */
export const LargerOfTwoSizes: Story = { args: { scene: 'pro', pick: 'largest' } }
/** A tablet leaning on its keyboard in the source scene, shown without it. */
export const Tablet: Story = { args: { scene: 'tablet', width: 820, height: 1180 } }
/** Not this panel's device to touch: every drag orbits, including on the glass. */
export const LookOnly: Story = { args: { interactive: false } }
export const Loading: Story = { args: { loadModel: () => new Promise(() => {}) } }
export const Failed: Story = { args: { loadModel: async () => { throw new Error('Corrupt model') } } }
export const Narrow: Story = {
  decorators: [(Story) => <div className="h-[420px] w-[200px] border-r bg-background"><Story /></div>],
}
/**
 * A skinned book-style foldable. Each posture sweeps the hinge and turns the lit
 * glass to the camera; the opened panel's portrait framebuffer lies turned under its
 * landscape glass, so a touch dot lands under the pointer at every angle.
 */
export const Foldable: Story = { render: () => <FoldableScenario initial="opened" /> }
export const FoldableHalfOpen: Story = { render: () => <FoldableScenario initial="half opened" /> }
export const FoldableClosed: Story = { render: () => <FoldableScenario initial="closed" /> }
/** Standing as a tent: the cover lit and faced to the camera, the hinge along the top. */
export const FoldableTent: Story = { render: () => <FoldableScenario initial="tent" /> }
