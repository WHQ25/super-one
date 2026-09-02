import { useCurrentFrame, interpolate } from "remotion"
import { EASE_IN_OUT, EASE_OUT, sec } from "../../feature-kit/index"

const KEY = (color: string) => (
  <svg width="64" height="64" viewBox="0 0 48 48" fill="none">
    <circle cx="14" cy="24" r="9" stroke={color} strokeWidth="3" />
    <circle cx="14" cy="24" r="2.5" fill={color} />
    <path d="M23 24h21" stroke={color} strokeWidth="3" strokeLinecap="round" />
    <path d="M36 24v6" stroke={color} strokeWidth="3" strokeLinecap="round" />
    <path d="M30 24v4" stroke={color} strokeWidth="3" strokeLinecap="round" />
  </svg>
)

const LOCK = (color: string, scale = 1) => (
  <svg width={64 * scale} height={64 * scale} viewBox="0 0 48 48" fill="none">
    <rect
      x="11"
      y="22"
      width="26"
      height="20"
      rx="4"
      stroke={color}
      strokeWidth="3"
    />
    <path
      d="M16 22v-5a8 8 0 0116 0v5"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
    <circle cx="24" cy="31" r="2.5" fill={color} />
    <path
      d="M24 33v4"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
)

export interface EncryptionExchangeProps {
  /** Sequence-relative frame the animation starts. */
  enter: number
  x: number
  y: number
  /** Outer width of the badge row. */
  width?: number
  /** Whether to render on a dark backdrop (light glyphs). */
  variant?: "light" | "dark"
}

/**
 * Small inline visual: two keys travel toward each other along a wire, meet in
 * the middle and resolve into a closed lock — a friendly stand-in for "E2E
 * handshake". Loops every ~2s after `enter`.
 */
export function EncryptionExchange({
  enter,
  x,
  y,
  width = 360,
  variant = "dark",
}: EncryptionExchangeProps) {
  const frame = useCurrentFrame()
  const dark = variant === "dark"
  const accent = dark ? "oklch(0.78 0.16 240)" : "oklch(0.55 0.18 240)"
  const dim = dark ? "oklch(0.55 0.06 240)" : "oklch(0.65 0.05 240)"

  const op = interpolate(frame, [enter, enter + sec(0.45)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  const loopLen = sec(2.0)
  const local = ((frame - enter) % loopLen + loopLen) % loopLen
  const t = local / loopLen

  // 0..0.5: keys travel inward. 0.5..0.7: flash. 0.7..1: lock holds, then keys reset.
  const travel = interpolate(t, [0, 0.45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  })
  const lockOpacity = interpolate(t, [0.42, 0.55, 0.9, 0.95], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const flash = interpolate(t, [0.45, 0.52, 0.65], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const keyOpacity = interpolate(t, [0.4, 0.5], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const half = width / 2
  const innerOffset = interpolate(travel, [0, 1], [half - 40, 12])

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        width,
        height: 110,
        opacity: op,
      }}
    >
      {/* Wire */}
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: "50%",
          height: 2,
          background: `linear-gradient(90deg, ${dim}, ${accent}, ${dim})`,
          borderRadius: 2,
          transform: "translateY(-50%)",
          opacity: 0.55,
        }}
      />
      {/* Flash on meet */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 140,
          height: 140,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}55, transparent 70%)`,
          opacity: flash,
          pointerEvents: "none",
        }}
      />
      {/* Left key (mirrored to face right) */}
      <div
        style={{
          position: "absolute",
          left: innerOffset,
          top: "50%",
          transform: "translate(0, -50%)",
          opacity: keyOpacity,
        }}
      >
        {KEY(accent)}
      </div>
      {/* Right key */}
      <div
        style={{
          position: "absolute",
          right: innerOffset,
          top: "50%",
          transform: "translate(0, -50%) scaleX(-1)",
          opacity: keyOpacity,
        }}
      >
        {KEY(accent)}
      </div>
      {/* Lock that appears at meet */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${interpolate(t, [0.42, 0.55], [0.7, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT })})`,
          opacity: lockOpacity,
        }}
      >
        {LOCK(accent, 1.1)}
      </div>
    </div>
  )
}
