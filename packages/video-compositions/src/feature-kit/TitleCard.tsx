// Full-screen intro + outro cards bracketing every feature video.

import { useCurrentFrame, interpolate, AbsoluteFill } from "remotion"
import { EASE_OUT, FEATURE_WIDTH, FEATURE_HEIGHT, fadeOut, sec } from "./kit"
import { SuperOneMark, Wordmark } from "./Brand"

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export interface TitleCardProps {
  index: number
  total?: number
  title: string
  subtitle: string
  hue?: number
  /** Sequence length in frames (controls the closing fade). */
  durationInFrames: number
}

export function TitleCard({
  index,
  total = 10,
  title,
  subtitle,
  hue = 42,
  durationInFrames,
}: TitleCardProps) {
  const frame = useCurrentFrame()
  const exit = fadeOut(frame, durationInFrames, sec(0.5))

  const step = (delay: number) =>
    interpolate(frame, [delay, delay + sec(0.55)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    })
  const rise = (delay: number) => (1 - step(delay)) * 26

  const kick = step(sec(0.15))
  const titleP = step(sec(0.4))
  const subP = step(sec(0.7))
  const numP = step(sec(0.25))

  return (
    <AbsoluteFill
      style={{
        background: "oklch(0.975 0.012 78)",
        opacity: exit,
      }}
    >
      {/* warm brand glow */}
      <div
        style={{
          position: "absolute",
          right: -260,
          top: -260,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, oklch(0.78 0.13 ${hue} / 0.35), transparent 65%)`,
        }}
      />
      {/* giant number watermark */}
      <div
        style={{
          position: "absolute",
          right: 96,
          top: FEATURE_HEIGHT / 2,
          transform: `translateY(-50%) scale(${0.92 + numP * 0.08})`,
          fontSize: 540,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: -16,
          color: `oklch(0.84 0.09 ${hue})`,
          opacity: numP * 0.5,
        }}
      >
        {pad2(index)}
      </div>

      <div
        style={{
          position: "absolute",
          left: 150,
          top: FEATURE_HEIGHT / 2,
          transform: "translateY(-50%)",
          width: 1180,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            opacity: kick,
            transform: `translateY(${rise(sec(0.15))}px)`,
          }}
        >
          <SuperOneMark size={46} hue={hue} />
          <Wordmark size={26} hue={hue} />
          <span style={{ width: 1, height: 26, background: "oklch(0.86 0.014 70)" }} />
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 2.4,
              color: `oklch(0.58 0.14 ${hue})`,
            }}
          >
            FEATURE {pad2(index)} / {pad2(total)}
          </span>
        </div>

        <div
          style={{
            fontSize: 96,
            fontWeight: 770,
            lineHeight: 1.04,
            letterSpacing: -2.4,
            color: "oklch(0.26 0.03 60)",
            opacity: titleP,
            transform: `translateY(${rise(sec(0.4))}px)`,
            maxWidth: 1080,
            whiteSpace: "pre-line",
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 30,
            fontWeight: 500,
            lineHeight: 1.45,
            color: "oklch(0.50 0.03 60)",
            opacity: subP,
            transform: `translateY(${rise(sec(0.7))}px)`,
            maxWidth: 880,
          }}
        >
          {subtitle}
        </div>
      </div>
    </AbsoluteFill>
  )
}

export interface OutroCardProps {
  tagline: string
  hue?: number
  durationInFrames: number
}

export function OutroCard({ tagline, hue = 42, durationInFrames }: OutroCardProps) {
  const frame = useCurrentFrame()
  const inP = interpolate(frame, [0, sec(0.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  const exit = fadeOut(frame, durationInFrames, sec(0.5))

  return (
    <AbsoluteFill
      style={{
        background: "oklch(0.975 0.012 78)",
        alignItems: "center",
        justifyContent: "center",
        opacity: exit,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 760,
          height: 760,
          borderRadius: "50%",
          background: `radial-gradient(circle, oklch(0.80 0.12 ${hue} / 0.30), transparent 66%)`,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          opacity: inP,
          transform: `translateY(${(1 - inP) * 20}px)`,
        }}
      >
        <SuperOneMark size={92} hue={hue} />
        <Wordmark size={56} hue={hue} />
        <div
          style={{
            fontSize: 26,
            fontWeight: 500,
            color: "oklch(0.50 0.03 60)",
            letterSpacing: 0.2,
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  )
}
