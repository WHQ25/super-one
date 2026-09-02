// Frames a desktop mock as a floating app window on a warm backdrop, with a
// subtle entrance and optional declarative zoom keyframes (Ken Burns / focus).

import { type ReactNode } from "react"
import { useCurrentFrame, interpolate, AbsoluteFill } from "remotion"
import { EASE_IN_OUT, EASE_OUT, FEATURE_WIDTH, sec } from "./kit"

export interface ZoomKeyframe {
  frame: number
  /** Window scale. 1 = fit. */
  scale: number
  /** Transform origin within the window, 0..1. */
  x: number
  y: number
}

export interface AppStageProps {
  children: ReactNode
  /** Native render size of the mock; it is scaled to the window box. */
  baseW?: number
  baseH?: number
  /** Displayed window box inside the 1920×1080 frame. */
  windowW?: number
  windowH?: number
  /** Window top edge — leaves clear space below for the caption. */
  top?: number
  /** Backdrop hue. */
  hue?: number
  /** Backdrop chroma — raise it to make a hue change read strongly. */
  bgChroma?: number
  darkMode?: boolean
  /** Frame the window enters at (Sequence-relative). */
  enterAt?: number
  zoom?: ZoomKeyframe[]
}

function track<T extends ZoomKeyframe>(
  keys: T[],
  frame: number,
  field: "scale" | "x" | "y",
): number {
  if (keys.length === 0) return field === "scale" ? 1 : 0.5
  if (frame <= keys[0].frame) return keys[0][field]
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return last[field]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (frame >= a.frame && frame <= b.frame) {
      return interpolate(frame, [a.frame, b.frame], [a[field], b[field]], {
        easing: EASE_IN_OUT,
      })
    }
  }
  return last[field]
}

export function AppStage({
  children,
  baseW = 1280,
  baseH = 800,
  windowW = 1500,
  windowH = 938,
  top = 34,
  hue = 42,
  bgChroma = 0.02,
  darkMode = false,
  enterAt = 0,
  zoom,
}: AppStageProps) {
  const frame = useCurrentFrame()

  const enter = interpolate(frame, [enterAt, enterAt + sec(0.7)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })

  const zScale = zoom ? track(zoom, frame, "scale") : 1
  const zx = zoom ? track(zoom, frame, "x") : 0.5
  const zy = zoom ? track(zoom, frame, "y") : 0.5

  const enterScale = interpolate(enter, [0, 1], [0.965, 1])
  const enterY = interpolate(enter, [0, 1], [26, 0])

  return (
    <AbsoluteFill
      style={{
        background: darkMode
          ? "linear-gradient(160deg, oklch(0.20 0.012 70), oklch(0.16 0.012 70))"
          : `linear-gradient(160deg, oklch(0.95 ${bgChroma} ${hue}), oklch(0.9 ${bgChroma * 1.5} ${hue}))`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: (FEATURE_WIDTH - windowW) / 2,
          top,
          width: windowW,
          height: windowH,
          opacity: enter,
          transform: `scale(${enterScale}) translateY(${enterY}px)`,
        }}
      >
        <div
          style={{
            width: windowW,
            height: windowH,
            transform: `scale(${zScale})`,
            transformOrigin: `${zx * 100}% ${zy * 100}%`,
          }}
        >
          <div
            style={{
              width: windowW,
              height: windowH,
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: darkMode
                ? "0 50px 110px -30px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.05)"
                : "0 50px 110px -30px rgba(60,40,15,0.55), 0 0 0 1px rgba(0,0,0,0.04)",
            }}
          >
            <div
              style={{
                width: baseW,
                height: baseH,
                transform: `scale(${windowW / baseW})`,
                transformOrigin: "top left",
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
