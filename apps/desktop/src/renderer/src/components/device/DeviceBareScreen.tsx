import type { CSSProperties, ReactNode, Ref } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { DeviceDescriptor } from '@superone/shared/device'

// What stands in when there is no artwork for this device — on iOS every iPad, every
// Apple TV, iPhone 11-14 and SE, and on Android everything, since there is no
// DeviceKit equivalent to ship. Nothing but the glass: no drawn body, no side keys,
// no shadow. A hand-drawn device next to Apple's photographed artwork reads as a
// mock-up of a simulator rather than a simulator, and the parts a guess gets wrong
// (button placement, body thickness) are exactly the parts a real device is
// recognised by. The toolbar already owns every key, so nothing is lost with it.
//
// The corner is not decoration and does stay: it is the shape of the framebuffer's
// own mask on the device it came from. Like the old body geometry it is a FRACTION
// of the rendered height, never a fixed px — a screen drawn 300px tall and one drawn
// 900px tall are the same object at two distances.
interface ScreenRatios {
  /** Corner extent as a fraction of screen height. */
  radius: number
  /**
   * Screen width ÷ height in portrait. This shell takes its width from the
   * framebuffer, so before one exists — a device that has not booted yet — this is
   * the only thing standing between the glass and zero width.
   */
  aspect: number
}

// The iPhone numbers are measured, not remembered. `profile.plist` for the iPhone
// 17 Pro Max gives a 1320 x 2868 screen, and rasterising its `framebufferMask` PDF
// and walking the alpha edge puts the corner curve's extent at 212px — 7.39% of the
// height, where the old guess said 6.45%.
const IPHONE_17_PRO_MAX = { width: 1320, height: 2868, corner: 212 }

/**
 * Keyed by `${platform}:${kind}` — the descriptor's own slug, so nothing here has to
 * re-derive what a device is. `kind` alone would not do: iOS `tv` and Android `tv`
 * are the same word for two different products.
 */
const RATIOS: Record<string, ScreenRatios> = {
  'ios:iphone': {
    radius: IPHONE_17_PRO_MAX.corner / IPHONE_17_PRO_MAX.height,
    aspect: IPHONE_17_PRO_MAX.width / IPHONE_17_PRO_MAX.height,
  },
  // iPads keep visibly squarer corners; that contrast is most of what separates an
  // iPad silhouette from a big iPhone once the body is gone.
  'ios:ipad': { radius: 0.024, aspect: 3 / 4 },
  'ios:watch': { radius: 0.3, aspect: 0.82 },
  // An Apple TV has no screen of its own — a plain rectangle is the honest shape.
  'ios:tv': { radius: 0.012, aspect: 16 / 9 },
  'ios:vision': { radius: 0.5, aspect: 4 / 3 },
  // 1080x2400 is what the stock AVD profiles and most shipping handsets use. Android
  // corner radii are a vendor choice rather than a platform one, so this is a middle
  // reading rather than a measurement of any one device.
  'android:phone': { radius: 0.035, aspect: 1080 / 2400 },
  'android:foldable': { radius: 0.03, aspect: 1080 / 1300 },
  'android:tablet': { radius: 0.02, aspect: 1600 / 2560 },
  'android:wear': { radius: 0.5, aspect: 1 },
  'android:tv': { radius: 0.012, aspect: 16 / 9 },
  'android:auto': { radius: 0.02, aspect: 16 / 9 },
  'android:desktop': { radius: 0.01, aspect: 16 / 9 },
}

/** Before any device is known — the environment probe runs before the list is read. */
const UNKNOWN: ScreenRatios = { radius: 0.05, aspect: 3 / 4 }

/**
 * The proportions to draw a device at before it has sent a frame.
 *
 * A `DeviceDescriptor` rather than a family enum so an unrecognised `kind` from
 * either platform lands on the neutral shape instead of failing to type-check —
 * both platforms classify from free-form hardware strings and can answer `other`.
 */
export function deviceRatios(device: DeviceDescriptor | null): ScreenRatios {
  if (!device) return UNKNOWN
  return RATIOS[`${device.platform}:${device.kind}`] ?? UNKNOWN
}

/** Portrait screen proportions, for standing in until a real frame arrives. */
export function deviceScreenAspect(device: DeviceDescriptor | null): number {
  return deviceRatios(device).aspect
}

export function deviceScreenRadius(device: DeviceDescriptor | null, height: number): number {
  return Math.round(height * deviceRatios(device).radius)
}

// Apple corners are continuous-curvature superellipses, not circular arcs. A plain
// `border-radius` arc meets the straight edge with a curvature jump, which is what
// reads as "bulging" and un-Apple.
//
// The exponent is fitted, not assumed. Least-squares over the same rasterised mask
// edge lands on 2.33 (rms 0.002); a circle (2) misses by 0.088 and the CSS `squircle`
// keyword — which is `superellipse(2)`, meaning exponent 2^2 = 4 — misses by 0.31,
// so the keyword this used to carry was drawing a corner markedly squarer than the
// device. `superellipse(k)` takes log2 of the exponent, hence 1.22.
//
// `corner-shape` is Chromium 139+, so every Electron build we ship on. Cast because
// the property is newer than our React CSS typings. Where the function form is not
// understood the declaration is dropped and the corner falls back to a circular arc,
// which is the closer of the two wrong answers.
const APPLE_CORNER = { cornerShape: 'superellipse(1.22)' } as unknown as CSSProperties

interface DeviceBareScreenProps {
  /** Null before any device is chosen; the neutral silhouette stands in. */
  device: DeviceDescriptor | null
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}

export function DeviceBareScreen({ device, ref, children }: DeviceBareScreenProps) {
  const screen = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const element = screen.current
    if (!element) return
    // Only the radius is written back from here, and a radius cannot change what the
    // observer measures — no ResizeObserver feedback loop.
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={(node) => {
        screen.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      // Same as the artwork shell: no host focus ring around a device whose guest
      // already shows where the keyboard is going.
      className="relative flex h-full max-h-full max-w-full items-center justify-center overflow-hidden bg-black outline-none"
      style={{ ...APPLE_CORNER, borderRadius: deviceScreenRadius(device, height) }}
    >
      {children}
    </div>
  )
}
