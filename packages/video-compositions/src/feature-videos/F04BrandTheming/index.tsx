// Feature 04 — Brand Theming: one hue slider re-tunes every surface.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion"
import {
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  HARNESS_CODEX_HUE,
  type MockMessage,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  Cursor,
  EASE_IN_OUT,
  EASE_OUT,
  FeatureVideo,
  fadeWindow,
  featureVideoDuration,
  makeStage,
  mapX,
  mapY,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const BRAND_THEMING_FPS = 30
export const BRAND_THEMING_WIDTH = 1920
export const BRAND_THEMING_HEIGHT = 1080

const STAGE = makeStage()

const CONVO: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Make the new-session screen feel calmer.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `Softened the spacing and dropped the accent to a lighter weight:

\`\`\`tsx
<Button variant="outline" size="sm">
  New session
</Button>
\`\`\`

The whole app already rides one accent token — \`--primary\` — so a single hue drives every button, ring and surface tint.`,
      },
    ],
  },
]

// ── Hue-track popover ───────────────────────────────────────────────────────
const HUE_STOPS = [0, 42, 95, 152, 210, 265, 320, 360]

function huePopover(hue: number): React.ReactNode {
  const trackW = 232
  const thumbX = (((hue % 360) + 360) % 360) / 360 * trackW
  const swatches = [42, 165, 265, 320]
  return (
    <div
      style={{
        width: 280,
        padding: 16,
        borderRadius: 16,
        background: "#fff",
        border: "1px solid oklch(0.88 0.014 70)",
        boxShadow: "0 26px 60px -18px rgba(40,28,10,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.3 0.03 60)" }}>
          Brand color
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: "oklch(0.55 0.03 60)",
          }}
        >
          {Math.round(((hue % 360) + 360) % 360)}°
        </span>
      </div>
      <div style={{ position: "relative", width: trackW, height: 18 }}>
        <div
          style={{
            width: trackW,
            height: 18,
            borderRadius: 9,
            background: `linear-gradient(90deg, ${HUE_STOPS.map(
              (h) => `oklch(0.70 0.17 ${h})`,
            ).join(", ")})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: thumbX,
            top: 9,
            transform: "translate(-50%, -50%)",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: `oklch(0.68 0.18 ${hue})`,
            border: "3px solid #fff",
            boxShadow: "0 3px 9px rgba(0,0,0,0.3)",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {swatches.map((h) => (
          <div
            key={h}
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: `oklch(0.70 0.17 ${h})`,
              border:
                Math.abs((((hue - h) % 360) + 360) % 360) < 8
                  ? "2.5px solid oklch(0.3 0.03 60)"
                  : "2.5px solid transparent",
            }}
          />
        ))}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  )
}

function ThemedApp({ hue }: { hue: number }): React.ReactNode {
  return (
    <BrandScope brandHue={hue} darkMode={false}>
      <ChatMock
        title="Make the new-session screen calmer"
        harness="claude"
        messages={CONVO}
        fps={BRAND_THEMING_FPS}
        showFooter={false}
      />
    </BrandScope>
  )
}

// Hue journey: hold Claude, sweep through the spectrum, settle on a deep amber.
function hueAt(frame: number): number {
  const stops: { f: number; h: number }[] = [
    { f: 0, h: HARNESS_CLAUDE_HUE },
    { f: sec(1.4), h: HARNESS_CLAUDE_HUE },
    { f: sec(3.0), h: HARNESS_CODEX_HUE },
    { f: sec(4.4), h: 268 },
    { f: sec(5.8), h: 322 },
    { f: sec(7.4), h: 20 },
  ]
  if (frame <= stops[0].f) return stops[0].h
  const last = stops[stops.length - 1]
  if (frame >= last.f) return last.h
  for (let i = 0; i < stops.length - 1; i++) {
    if (frame >= stops[i].f && frame <= stops[i + 1].f) {
      return interpolate(frame, [stops[i].f, stops[i + 1].f], [stops[i].h, stops[i + 1].h], {
        easing: EASE_IN_OUT,
      })
    }
  }
  return last.h
}

// ── Beat A — open the brand-color popover ───────────────────────────────────
function BeatOpen(): React.ReactNode {
  const frame = useCurrentFrame()
  const palette = { x: mapX(STAGE, 48), y: mapY(STAGE, 778) }
  const popOpacity = fadeWindow(frame, sec(3.3), sec(5.6), sec(0.35))
  const popPop = interpolate(frame, [sec(3.3), sec(3.7)], [0.88, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE} bgChroma={0.072}>
        <ThemedApp hue={HARNESS_CLAUDE_HUE} />
      </AppStage>
      <Cursor
        path={[
          { frame: sec(0.9), x: 940, y: 520 },
          { frame: sec(3.0), x: palette.x, y: palette.y },
          { frame: sec(3.3), x: palette.x, y: palette.y, click: true },
        ]}
      />
      <div
        style={{
          position: "absolute",
          left: palette.x - 18,
          top: palette.y - 232,
          opacity: popOpacity,
          transform: `scale(${popPop})`,
          transformOrigin: "left bottom",
        }}
      >
        {huePopover(HARNESS_CLAUDE_HUE)}
      </div>
      <Caption
        text="Light mode wears a brand hue — Claude amber, Codex green, or anything you like."
        kicker="BRAND THEMING"
        enter={sec(0.5)}
        exit={sec(5.6)}
      />
    </AbsoluteFill>
  )
}

// ── Beat B — drag the slider, the whole app recolors ────────────────────────
function BeatRecolor(): React.ReactNode {
  const frame = useCurrentFrame()
  const hue = hueAt(frame)
  const palette = { x: mapX(STAGE, 48), y: mapY(STAGE, 778) }
  const popLeft = palette.x - 18
  const popTop = palette.y - 232
  // Cursor rides the slider thumb.
  const trackLeftInComp = popLeft + 16
  const thumbX = trackLeftInComp + (((hue % 360) + 360) % 360) / 360 * 232
  const thumbY = popTop + 16 + 14 + 13 + 9
  return (
    <AbsoluteFill>
      <AppStage hue={hue} bgChroma={0.088}>
        <ThemedApp hue={hue} />
      </AppStage>
      <div
        style={{
          position: "absolute",
          left: popLeft,
          top: popTop,
        }}
      >
        {huePopover(hue)}
      </div>
      <Cursor
        path={[
          { frame: 0, x: thumbX, y: thumbY },
          { frame: 1, x: thumbX, y: thumbY },
        ]}
      />
      <Caption
        text="Drag once — every button, ring, surface tint and sidebar shifts together."
        kicker="ONE SLIDER · EVERY SURFACE"
        enter={sec(0.4)}
        exit={sec(7.6)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — settled hue ────────────────────────────────────────────────────
function BeatSettled(): React.ReactNode {
  return (
    <AbsoluteFill>
      <AppStage
        hue={20}
        bgChroma={0.084}
        zoom={[
          { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
          { frame: sec(4.4), scale: 1.1, x: 0.5, y: 0.42 },
        ]}
      >
        <ThemedApp hue={20} />
      </AppStage>
      <Caption
        text="Per-harness, per-taste — your workspace, tuned to your eye."
        kicker="MAKE IT YOURS"
        enter={sec(0.5)}
        exit={sec(4.2)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(6.0), content: <BeatOpen /> },
  { durationInFrames: sec(8.2), content: <BeatRecolor /> },
  { durationInFrames: sec(4.6), content: <BeatSettled /> },
]

export const BRAND_THEMING_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const brandThemingDefaultProps = {}

export function BrandThemingVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={4}
      title={"One hue.\nEvery surface."}
      subtitle="SuperOne's whole light-mode palette rides a single accent token — slide the brand hue and the entire workspace re-tunes instantly."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="A workspace tuned to you."
    />
  )
}
