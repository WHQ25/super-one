import { useCurrentFrame, interpolate } from "remotion"
import { EASE_OUT, FEATURE_WIDTH, fadeWindow, sec } from "../../feature-kit/index"

export interface ChapterBannerProps {
  index: number
  total?: number
  title: string
  enter: number
  exit: number
  hue?: number
  y?: number
}

export function ChapterBanner({
  index,
  total = 4,
  title,
  enter,
  exit,
  hue = 42,
  y = 86,
}: ChapterBannerProps) {
  const frame = useCurrentFrame()
  const opacity = fadeWindow(frame, enter, exit, sec(0.28))
  if (opacity <= 0.001) return null

  const rise = interpolate(frame, [enter, enter + sec(0.45)], [22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: y + rise,
        width: FEATURE_WIDTH,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        opacity,
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 3.6,
          color: `oklch(0.78 0.16 ${hue})`,
        }}
      >
        CH·{String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
      <span
        style={{
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: -2,
          lineHeight: 1.02,
          color: "#fbf6ee",
          textShadow: "0 18px 48px rgba(0,0,0,0.55)",
          textAlign: "center",
        }}
      >
        {title}
      </span>
    </div>
  )
}
