// On-screen keyboard-shortcut overlay. Whenever a feature has a real shortcut,
// the video surfaces it with a floating hint whose last key visibly "presses".

import { useCurrentFrame } from "remotion"
import { EASE_OUT, fadeWindow, sec } from "./kit"
import { interpolate } from "remotion"

export interface KeycapProps {
  glyph: string
  /** 0..1 press depth — drives the depress + tint. */
  press?: number
  size?: "sm" | "md"
}

export function Keycap({ glyph, press = 0, size = "md" }: KeycapProps) {
  const wide = glyph.length > 1
  const dim = size === "sm" ? 30 : 40
  const font = size === "sm" ? 13 : 17
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: wide ? dim * 1.7 : dim,
        height: dim,
        padding: wide ? "0 12px" : 0,
        borderRadius: 9,
        fontSize: font,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: press > 0.5 ? "#fff" : "oklch(0.30 0.03 60)",
        background:
          press > 0.5
            ? "oklch(0.62 0.17 42)"
            : "linear-gradient(180deg, #ffffff, oklch(0.95 0.012 70))",
        border: "1px solid oklch(0.86 0.014 70)",
        borderBottomWidth: press > 0.5 ? 1 : 3,
        boxShadow:
          press > 0.5
            ? "inset 0 2px 4px rgba(0,0,0,0.25)"
            : "0 1px 0 oklch(0.80 0.02 70), 0 2px 5px rgba(0,0,0,0.10)",
        transform: `translateY(${press * 2.4}px)`,
      }}
    >
      {glyph}
    </span>
  )
}

export interface ShortcutHintProps {
  /** Key glyphs left→right, e.g. ["⌘", "N"] or ["⇧", "Tab"]. */
  keys: string[]
  label?: string
  /** Composition-space center position. */
  x: number
  y: number
  /** Sequence-relative frames. */
  enter: number
  exit: number
  /** Frame at which the final key depresses (a quick tap). */
  pressAt?: number
}

export function ShortcutHint({ keys, label, x, y, enter, exit, pressAt }: ShortcutHintProps) {
  const frame = useCurrentFrame()
  const opacity = fadeWindow(frame, enter, exit, sec(0.32))
  if (opacity <= 0.001) return null

  const pop = interpolate(frame, [enter, enter + sec(0.3)], [0.86, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  // The last key taps down then springs back over ~7 frames.
  let press = 0
  if (pressAt !== undefined) {
    if (frame >= pressAt && frame < pressAt + 4) {
      press = interpolate(frame, [pressAt, pressAt + 4], [0, 1])
    } else if (frame >= pressAt + 4 && frame < pressAt + 9) {
      press = interpolate(frame, [pressAt + 4, pressAt + 9], [1, 0])
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${pop})`,
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 16px",
        borderRadius: 16,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(8px)",
        border: "1px solid oklch(0.88 0.014 70)",
        boxShadow: "0 14px 38px -10px rgba(40,30,10,0.40)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {keys.map((k, i) => (
          <Keycap key={i} glyph={k} press={i === keys.length - 1 ? press : 0} />
        ))}
      </div>
      {label ? (
        <span
          style={{
            fontSize: 16,
            fontWeight: 550,
            color: "oklch(0.42 0.03 60)",
            paddingRight: 4,
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  )
}
