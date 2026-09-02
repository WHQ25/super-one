// SuperOne wordmark + tile mark, reused by the title and outro cards.

export interface SuperOneMarkProps {
  size?: number
  /** Brand hue for the tile (Claude 42 / Codex 165). */
  hue?: number
}

/** A warm rounded tile holding two stacked sheets — the "canvas + chat" idea. */
export function SuperOneMark({ size = 56, hue = 42 }: SuperOneMarkProps) {
  const r = size * 0.26
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(155deg, oklch(0.74 0.16 ${hue}), oklch(0.60 0.18 ${hue}))`,
        boxShadow: `0 8px 22px -6px oklch(0.62 0.17 ${hue} / 0.55)`,
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: size * 0.27,
          top: size * 0.22,
          width: size * 0.4,
          height: size * 0.5,
          borderRadius: size * 0.1,
          background: "rgba(255,255,255,0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: size * 0.4,
          top: size * 0.34,
          width: size * 0.4,
          height: size * 0.5,
          borderRadius: size * 0.1,
          background: "#fff",
        }}
      />
    </div>
  )
}

export interface WordmarkProps {
  size?: number
  hue?: number
  light?: boolean
}

export function Wordmark({ size = 30, hue = 42, light = false }: WordmarkProps) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 700,
        letterSpacing: -0.5,
        color: light ? "#fbf6ee" : "oklch(0.30 0.03 60)",
      }}
    >
      Super
      <span style={{ color: `oklch(0.62 0.17 ${hue})` }}>One</span>
    </span>
  )
}
