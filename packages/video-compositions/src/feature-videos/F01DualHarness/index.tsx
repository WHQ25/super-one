// Feature 01 — Dual Harness: Claude and Codex in one workspace.

import { AbsoluteFill, useCurrentFrame } from "remotion"
import {
  ChatMock,
  NewSessionMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  Cursor,
  FeatureVideo,
  ShortcutHint,
  featureVideoDuration,
  makeStage,
  mapX,
  mapY,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const DUAL_HARNESS_FPS = 30
export const DUAL_HARNESS_WIDTH = 1920
export const DUAL_HARNESS_HEIGHT = 1080

const STAGE = makeStage()

const CODEX_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Add a /healthz endpoint to the relay worker and return the uptime.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `Done. I added a \`/healthz\` route to the Worker that reports uptime and the live channel count:

\`\`\`ts
if (url.pathname === "/healthz") {
  return Response.json({
    ok: true,
    uptimeMs: Date.now() - bootedAt,
    channels: rooms.size,
  })
}
\`\`\`

It runs before the WebSocket upgrade check, so a plain GET never touches the relay path.`,
      },
    ],
  },
]

// ── Beat A — New session, switch Claude → Codex ─────────────────────────────
function BeatNewSession(): React.ReactNode {
  const codex = { x: mapX(STAGE, 859), y: mapY(STAGE, 381) }
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <NewSessionMock
          harness="claude"
          frame={0}
          selectedProject="super-one"
          appsExpanded={false}
        />
      </AppStage>
      <ShortcutHint
        keys={["⌘", "N"]}
        label="New session"
        x={960}
        y={132}
        enter={sec(0.5)}
        exit={sec(3.2)}
        pressAt={sec(1.0)}
      />
      <Cursor
        path={[
          { frame: sec(1.3), x: 1120, y: 820 },
          { frame: sec(3.7), x: codex.x, y: codex.y },
          { frame: sec(4.0), x: codex.x, y: codex.y, click: true },
        ]}
      />
      <Caption
        text="One workspace, two coding agents — switch harness in a single click."
        kicker="CLAUDE  +  CODEX"
        enter={sec(0.6)}
        exit={sec(5.8)}
      />
    </AbsoluteFill>
  )
}

// ── Beat B — Codex selected ─────────────────────────────────────────────────
function BeatCodexSelected(): React.ReactNode {
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1, x: 0.5, y: 0.4 },
          { frame: sec(4.6), scale: 1.12, x: 0.52, y: 0.36 },
        ]}
      >
        <NewSessionMock
          harness="codex"
          frame={0}
          selectedProject="super-one"
          appsExpanded={false}
        />
      </AppStage>
      <Caption
        text="Codex brings GPT-class coding into the very same canvas."
        kicker="GPT-5.5  ·  NATIVE"
        enter={sec(0.4)}
        exit={sec(4.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — A running Codex turn, then the dual-harness sidebar ─────────────
function BeatRunningTurn(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.0, x: 0.5, y: 0.5 },
          { frame: sec(5.6), scale: 1.0, x: 0.5, y: 0.5 },
          { frame: sec(7.4), scale: 1.26, x: 0.045, y: 0.54 },
        ]}
      >
        <ChatMock
          title="Add /healthz to relay worker"
          harness="codex"
          messages={CODEX_CHAT}
          frame={frame}
          fps={DUAL_HARNESS_FPS}
          typingCps={94}
          userPauseMs={500}
          assistantPauseMs={420}
        />
      </AppStage>
      <Caption
        text="Codex ships the fix — streamed token by token, like the real model."
        kicker="LIVE TURN"
        enter={sec(0.5)}
        exit={sec(5.3)}
      />
      <Caption
        text="Claude and Codex sessions live together in every project."
        kicker="ONE PROJECT  ·  EITHER MIND"
        enter={sec(6.0)}
        exit={sec(8.6)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(6.2), content: <BeatNewSession /> },
  { durationInFrames: sec(4.8), content: <BeatCodexSelected /> },
  { durationInFrames: sec(8.9), content: <BeatRunningTurn /> },
]

export const DUAL_HARNESS_DURATION_IN_FRAMES = featureVideoDuration(BEATS)

export const dualHarnessDefaultProps = {}

export function DualHarnessVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={1}
      title={"Two agents.\nOne workspace."}
      subtitle="Claude and Codex run side by side in SuperOne — pick the right mind for every task without leaving the window."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Claude + Codex, together."
    />
  )
}
