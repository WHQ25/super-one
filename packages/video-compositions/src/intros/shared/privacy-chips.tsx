import { useCurrentFrame, interpolate } from "remotion"
import { EASE_OUT, sec } from "../../feature-kit/index"

const CHECK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M5 12.5l4.5 4.5L19 7.5"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export interface PrivacyChipsProps {
  /** Sequence-relative frame when the first chip enters. */
  enter: number
  /** Where to anchor the row (composition coords). */
  x: number
  y: number
  /** Chip stagger in frames. */
  stagger?: number
  /** Per-chip color hue. Defaults to a calm green. */
  hue?: number
  variant?: "light" | "dark"
}

const LABELS = [
  "No data stored",
  "End-to-end encrypted",
  "Files transferred encrypted, too",
]

export function PrivacyChips({
  enter,
  x,
  y,
  stagger = 14,
  hue = 152,
  variant = "light",
}: PrivacyChipsProps) {
  const frame = useCurrentFrame()
  const dark = variant === "dark"

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      {LABELS.map((label, i) => {
        const start = enter + stagger * i
        const op = interpolate(frame, [start, start + sec(0.4)], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE_OUT,
        })
        const slide = interpolate(frame, [start, start + sec(0.4)], [16, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE_OUT,
        })
        return (
          <div
            key={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 18px 12px 14px",
              borderRadius: 999,
              background: dark
                ? "linear-gradient(135deg, oklch(0.30 0.04 240), oklch(0.22 0.04 240))"
                : "rgba(255,255,255,0.94)",
              border: dark
                ? "1px solid oklch(0.45 0.08 240)"
                : "1px solid oklch(0.88 0.014 70)",
              boxShadow: dark
                ? "0 14px 38px -12px rgba(0,0,0,0.55)"
                : "0 14px 38px -14px rgba(40,30,10,0.36)",
              opacity: op,
              transform: `translateX(${slide}px)`,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: `oklch(0.68 0.18 ${hue})`,
                color: "#fff",
              }}
            >
              {CHECK}
            </span>
            <span
              style={{
                fontSize: 19,
                fontWeight: 600,
                color: dark ? "#fbf6ee" : "oklch(0.28 0.03 60)",
                letterSpacing: -0.1,
              }}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
