import { Player, type PlayerRef } from "@remotion/player"
import { type CSSProperties, type ComponentType, useEffect, useRef } from "react"

export interface PlayerStageProps<T extends Record<string, unknown>> {
  component: ComponentType<T>
  inputProps: T
  durationInFrames: number
  fps: number
  compositionWidth: number
  compositionHeight: number
  displayWidth?: number
  displayHeight?: number
  background?: string
  loop?: boolean
  autoPlay?: boolean
  controls?: boolean
}

const STAGE_BACKGROUND = "var(--muted, #f5f5f4)"

export function PlayerStage<T extends Record<string, unknown>>({
  component,
  inputProps,
  durationInFrames,
  fps,
  compositionWidth,
  compositionHeight,
  displayWidth = 1280,
  displayHeight,
  background = STAGE_BACKGROUND,
  loop = true,
  autoPlay = false,
  controls = true,
}: PlayerStageProps<T>) {
  const ref = useRef<PlayerRef>(null)
  const aspect = compositionHeight / compositionWidth
  const computedDisplayHeight = displayHeight ?? Math.round(displayWidth * aspect)

  useEffect(() => {
    if (!autoPlay) return
    const id = window.setTimeout(() => ref.current?.play(), 80)
    return () => window.clearTimeout(id)
  }, [autoPlay, inputProps])

  const stageStyle: CSSProperties = {
    width: displayWidth,
    height: computedDisplayHeight,
    background,
    borderRadius: 12,
    overflow: "hidden",
    boxShadow:
      "0 1px 0 rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.18)",
  }

  return (
    <div style={stageStyle}>
      <Player
        ref={ref}
        component={component as ComponentType<Record<string, unknown>>}
        inputProps={inputProps as Record<string, unknown>}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        controls={controls}
        loop={loop}
        clickToPlay
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  )
}
