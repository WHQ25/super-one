import { AnimatePresence, motion } from 'motion/react'
import { useIosSimulatorPreview } from './use-ios-simulator-preview'

/** The expanded box: a fixed inset, so the backdrop panes beside it can be fixed too. */
export const IOS_SIMULATOR_EXPANDED_BOX: React.CSSProperties = {
  left: '5vw', top: '5vh', width: '90vw', height: '90vh',
}

const BACKDROP_PANES: Array<{ key: string; style: React.CSSProperties }> = [
  { key: 'top', style: { left: 0, top: 0, width: '100vw', height: '5vh' } },
  { key: 'bottom', style: { left: 0, bottom: 0, width: '100vw', height: '5vh' } },
  { key: 'left', style: { left: 0, top: '5vh', width: '5vw', height: '90vh' } },
  { key: 'right', style: { right: 0, top: '5vh', width: '5vw', height: '90vh' } },
]

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.16 },
} as const

/**
 * Everything the expanded overlay paints UNDER the device: the dimmed margins, and
 * the card the device sits on.
 *
 * Split out from `IosSimulatorPictureInPicture` for one reason — paint order. The
 * device itself lives in `IosSimulatorHostLayer`, between this and the preview's
 * chrome, because it has to be above the card (or the card's `bg-background` would
 * hide it) and below the shrink and hide buttons (or a wide device would swallow
 * them). Three DOM siblings in that order is the whole mechanism; z-index cannot do
 * it, because the buttons live inside a box that would have to out-rank the device
 * as a whole for them to.
 */
export function IosSimulatorOverlaySurface() {
  const { expanded } = useIosSimulatorPreview()

  return (
    <AnimatePresence>
      {expanded && [
        ...BACKDROP_PANES.map((pane) => (
          <motion.div
            key={`device-overlay-backdrop:${pane.key}`}
            aria-hidden="true"
            {...FADE}
            className="pointer-events-auto fixed bg-background/80 backdrop-blur-sm"
            style={pane.style}
          />
        )),
        <motion.div
          key="device-overlay-surface"
          aria-hidden="true"
          {...FADE}
          className="fixed overflow-hidden border border-border bg-background shadow-2xl"
          style={IOS_SIMULATOR_EXPANDED_BOX}
        />,
      ]}
    </AnimatePresence>
  )
}
