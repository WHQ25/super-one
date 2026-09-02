// Lower-third caption that narrates each beat of a feature video.

import { useCurrentFrame, interpolate } from "remotion"
import { EASE_OUT, FEATURE_WIDTH, FEATURE_HEIGHT, fadeWindow, sec } from "./kit"

export interface CaptionProps {
  text: string
  /** Optional small kicker shown above the text, e.g. "STEP 02". */
  kicker?: string
  enter: number
  exit: number
  /** Vertical center; defaults to a lower-third position. */
  y?: number
}

export function Caption({ text, kicker, enter, exit, y }: CaptionProps) {
  const frame = useCurrentFrame()
  const opacity = fadeWindow(frame, enter, exit, sec(0.4))
  if (opacity <= 0.001) return null

  const rise = interpolate(frame, [enter, enter + sec(0.5)], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: (y ?? FEATURE_HEIGHT - 100) + rise,
        width: FEATURE_WIDTH,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        opacity,
      }}
    >
      {kicker ? (
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 2.6,
            color: "oklch(0.62 0.17 42)",
          }}
        >
          {kicker}
        </span>
      ) : null}
      <div
        style={{
          maxWidth: 1180,
          padding: "13px 26px",
          borderRadius: 18,
          background: "rgba(28,22,12,0.82)",
          backdropFilter: "blur(6px)",
          fontSize: 26,
          fontWeight: 560,
          lineHeight: 1.35,
          textAlign: "center",
          color: "#fbf6ee",
          boxShadow: "0 16px 40px -14px rgba(0,0,0,0.5)",
        }}
      >
        {text}
      </div>
    </div>
  )
}
