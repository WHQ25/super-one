// Feature 02 — Mini-Apps: the agent builds you a real, runnable app.

import { AbsoluteFill, useCurrentFrame } from "remotion"
import {
  ChatMock,
  HARNESS_CLAUDE_HUE,
  type MockApp,
  type MockMessage,
} from "@superone/desktop-mocks"
import { MiniAppFullscreenShell } from "../../MiniAppFullscreenScene/index"
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

export const MINI_APPS_FPS = 30
export const MINI_APPS_WIDTH = 1920
export const MINI_APPS_HEIGHT = 1080

const STAGE = makeStage()

const BUILD_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Build me a sprint board mini-app — three columns, drag-free, reads my todos.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "On it. I'll scaffold a sandboxed mini-app, wire it to the todo bridge, and register it so it shows up in your Apps drawer.",
      },
      {
        type: "tool",
        cost: 150,
        expanded: true,
        spec: {
          variant: "edit",
          filePath: "apps/sprint-board/index.html",
          startLine: 1,
          oldText: "",
          newText: `<div id="board"></div>
<script type="module">
  const cols = ["Todo", "Doing", "Done"]
  const todos = await superone.todos.list()
  render(board, cols, todos)
</script>`,
        },
      },
      {
        type: "tool",
        cost: 110,
        expanded: true,
        spec: {
          variant: "bash",
          command: "superone miniapp register ./apps/sprint-board",
          output:
            "✓ manifest validated  (appId: sprint-board)\n✓ packed sprint-board.s1app  (14.2 KB)\n✓ installed → Apps drawer slot 1",
        },
      },
      {
        type: "markdown",
        text: "Done — **Sprint Board** is installed. Press `1` to open it fullscreen.",
      },
    ],
  },
]

const APPS_WITH_NEW: MockApp[] = [
  { id: "sprint-board", name: "Sprint Board", description: "Kanban over your agent todos" },
  { id: "design-canvas", name: "Design Canvas", description: "Sketch UI with the agent" },
  { id: "db-explorer", name: "DB Explorer", description: "Browse the session SQLite DB" },
  { id: "relay-inspector", name: "Relay Inspector", description: "Live mobile↔desktop frames", isDev: true },
]

// ── A lightweight kanban body rendered inside the mini-app shell ─────────────
const COLUMNS: { title: string; tint: string; cards: string[] }[] = [
  {
    title: "Todo",
    tint: "oklch(0.62 0.04 60)",
    cards: ["Audit relay reconnect", "Draft 0.38 changelog", "Trim sidebar bundle"],
  },
  {
    title: "Doing",
    tint: "oklch(0.66 0.15 42)",
    cards: ["Refactor permission lifecycle", "Wire /healthz endpoint"],
  },
  {
    title: "Done",
    tint: "oklch(0.62 0.13 152)",
    cards: ["Token-stream the video mocks", "Ship worktree popover", "Fix mDNS EPERM"],
  },
]

function KanbanBody(): React.ReactNode {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: 22,
        height: "100%",
        background: "oklch(0.975 0.01 75)",
      }}
    >
      {COLUMNS.map((col) => (
        <div
          key={col.title}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "oklch(0.955 0.012 75)",
            borderRadius: 14,
            padding: 12,
            border: "1px solid oklch(0.9 0.014 70)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 6px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.tint }} />
            <span style={{ fontSize: 14, fontWeight: 650, color: "oklch(0.32 0.03 60)" }}>
              {col.title}
            </span>
            <span style={{ fontSize: 12, color: "oklch(0.6 0.02 60)" }}>{col.cards.length}</span>
          </div>
          {col.cards.map((card) => (
            <div
              key={card}
              style={{
                background: "#fff",
                borderRadius: 10,
                padding: "11px 12px",
                fontSize: 13,
                fontWeight: 500,
                color: "oklch(0.34 0.025 60)",
                boxShadow: "0 1px 3px rgba(40,30,10,0.08)",
                borderLeft: `3px solid ${col.tint}`,
              }}
            >
              {card}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Beat A — Agent builds the mini-app ──────────────────────────────────────
function BeatBuild(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Build a sprint board mini-app"
          harness="claude"
          messages={BUILD_CHAT}
          frame={frame}
          fps={MINI_APPS_FPS}
          typingCps={150}
          userPauseMs={400}
          assistantPauseMs={300}
        />
      </AppStage>
      <Caption
        text="Describe an app in plain words — the agent scaffolds, packs and installs it."
        kicker="AGENT AS BUILD ENGINE"
        enter={sec(0.5)}
        exit={sec(9.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat B — The app appears in the drawer; press 1 to open ─────────────────
function BeatDrawer(): React.ReactNode {
  const slot1 = { x: mapX(STAGE, 150), y: mapY(STAGE, 250) }
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.05, x: 0.12, y: 0.2 },
          { frame: sec(4.6), scale: 1.2, x: 0.1, y: 0.26 },
        ]}
      >
        <ChatMock
          title="Build a sprint board mini-app"
          harness="claude"
          messages={BUILD_CHAT}
          appsExpanded
          apps={APPS_WITH_NEW}
          showFooter={false}
        />
      </AppStage>
      <ShortcutHint
        keys={["1"]}
        label="Open mini-app"
        x={960}
        y={140}
        enter={sec(1.0)}
        exit={sec(4.6)}
        pressAt={sec(3.4)}
      />
      <Cursor
        path={[
          { frame: sec(0.6), x: 760, y: 560 },
          { frame: sec(3.0), x: slot1.x, y: slot1.y },
          { frame: sec(3.3), x: slot1.x, y: slot1.y, click: true },
        ]}
      />
      <Caption
        text="It lands in the Apps drawer — open it with a single number key."
        kicker="APPS DRAWER"
        enter={sec(0.5)}
        exit={sec(4.6)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — The mini-app runs fullscreen ───────────────────────────────────
function BeatRun(): React.ReactNode {
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.04, x: 0.5, y: 0.5 },
          { frame: sec(6.5), scale: 1.0, x: 0.5, y: 0.5 },
        ]}
      >
        <MiniAppFullscreenShell appName="Sprint Board" appVersion="v1.0.0">
          <KanbanBody />
        </MiniAppFullscreenShell>
      </AppStage>
      <Caption
        text="Mini-apps run sandboxed in their own window — built, owned and driven by your agent."
        kicker="YOUR APP, RUNNING"
        enter={sec(0.5)}
        exit={sec(6.0)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(10.0), content: <BeatBuild /> },
  { durationInFrames: sec(5.2), content: <BeatDrawer /> },
  { durationInFrames: sec(6.6), content: <BeatRun /> },
]

export const MINI_APPS_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const miniAppsDefaultProps = {}

export function MiniAppsVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={2}
      title={"Your agent\nbuilds the app."}
      subtitle="Describe what you need and SuperOne's coding agent scaffolds a real, sandboxed mini-app — installed and runnable in seconds."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="A canvas where agents ship apps."
    />
  )
}
