import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { BrandScope, HARNESS_CLAUDE_HUE } from "@superone/desktop-mocks"

export const INTRO_FPS = 30
export const INTRO_WIDTH = 1280
export const INTRO_HEIGHT = 800
export const INTRO_DURATION_IN_FRAMES = 8 * INTRO_FPS

export type IntroSceneProps = {
  title: string
  tagline: string
  brandHue: number
  darkMode: boolean
}

export const introSceneDefaultProps: IntroSceneProps = {
  title: "SuperOne",
  tagline: "A meta desktop app for AI-powered creation",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1)

const Orb = ({ delay, x, y, size }: { delay: number; x: number; y: number; size: number }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const appear = interpolate(frame, [delay, delay + fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })
  const drift = Math.sin((frame / durationInFrames) * Math.PI * 2 + delay) * 24
  return (
    <div
      className="bg-primary absolute rounded-full blur-3xl"
      style={{
        width: size,
        height: size,
        left: x,
        top: y,
        opacity: appear * 0.18,
        transform: `translateY(${drift}px)`,
      }}
    />
  )
}

export const IntroScene = ({ title, tagline, brandHue, darkMode }: IntroSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleOpacity = interpolate(frame, [fps * 0.2, fps * 1.1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })
  const titleY = interpolate(frame, [fps * 0.2, fps * 1.1], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })
  const underlineWidth = interpolate(frame, [fps * 0.9, fps * 2.1], [0, 360], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })
  const taglineOpacity = interpolate(frame, [fps * 1.6, fps * 2.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })
  const taglineY = interpolate(frame, [fps * 1.6, fps * 2.6], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })
  const badgeOpacity = interpolate(frame, [fps * 2.6, fps * 3.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="bg-background items-center justify-center overflow-hidden">
        <Orb delay={fps * 0.1} x={140} y={120} size={360} />
        <Orb delay={fps * 0.5} x={INTRO_WIDTH - 460} y={INTRO_HEIGHT - 420} size={420} />
        <div className="relative flex flex-col items-center gap-7">
          <div
            className="text-foreground text-[140px] font-semibold tracking-tight leading-none"
            style={{ opacity: titleOpacity, transform: `translateY(${titleY}px)` }}
          >
            {title}
          </div>
          <div
            className="bg-primary h-[4px] rounded-full"
            style={{ width: underlineWidth }}
          />
          <div
            className="text-muted-foreground text-[34px] tracking-wide"
            style={{ opacity: taglineOpacity, transform: `translateY(${taglineY}px)` }}
          >
            {tagline}
          </div>
          <div
            className="border-border text-muted-foreground mt-2 rounded-full border px-4 py-1.5 text-[18px] tracking-widest uppercase"
            style={{ opacity: badgeOpacity }}
          >
            Placeholder intro
          </div>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
