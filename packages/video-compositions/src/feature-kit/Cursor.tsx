// A macOS-style pointer that travels between waypoints and ripples on click.
// Waypoint frames are Sequence-relative; positions are composition-space.

import { useCurrentFrame, interpolate } from "remotion"
import { EASE_IN_OUT } from "./kit"

export interface CursorWaypoint {
  frame: number
  x: number
  y: number
  /** A click lands at this waypoint's frame. */
  click?: boolean
}

export interface CursorProps {
  path: CursorWaypoint[]
  /** Hide the cursor before its first waypoint frame. */
  hideBefore?: boolean
}

function valueAt(path: CursorWaypoint[], frame: number, key: "x" | "y"): number {
  if (frame <= path[0].frame) return path[0][key]
  const last = path[path.length - 1]
  if (frame >= last.frame) return last[key]
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    if (frame >= a.frame && frame <= b.frame) {
      return interpolate(frame, [a.frame, b.frame], [a[key], b[key]], {
        easing: EASE_IN_OUT,
      })
    }
  }
  return last[key]
}

export function Cursor({ path, hideBefore = true }: CursorProps) {
  const frame = useCurrentFrame()
  if (path.length === 0) return null
  if (hideBefore && frame < path[0].frame - 1) return null

  const x = valueAt(path, frame, "x")
  const y = valueAt(path, frame, "y")

  // Nearest click within a short window → press + ripple.
  let press = 0
  let ripple: { age: number } | null = null
  for (const wp of path) {
    if (!wp.click) continue
    const d = frame - wp.frame
    if (d >= -3 && d < 4) press = Math.max(press, 1 - Math.abs(d) / 4)
    if (d >= 0 && d < 22) ripple = { age: d / 22 }
  }

  return (
    <div style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      {ripple ? (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: 8,
            height: 8,
            marginLeft: -4,
            marginTop: -4,
            borderRadius: "50%",
            border: "2.5px solid oklch(0.62 0.17 42)",
            transform: `scale(${1 + ripple.age * 7})`,
            opacity: (1 - ripple.age) * 0.7,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `scale(${1 - press * 0.16})`,
          transformOrigin: "4px 3px",
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.35))",
        }}
      >
        <svg width="30" height="36" viewBox="0 0 30 36" fill="none">
          <path
            d="M5 3 L5 27 L11.5 21 L15.5 30.5 L19.5 28.8 L15.6 19.3 L24 19.3 Z"
            fill="#ffffff"
            stroke="#1a1a1a"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
