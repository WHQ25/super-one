// Feature 06 — Parallel Sessions: many agents at once, nothing loses its place.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion"
import {
  ChatMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
  type MockProject,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  EASE_OUT,
  FeatureVideo,
  ShortcutHint,
  fadeWindow,
  featureVideoDuration,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const PARALLEL_SESSIONS_FPS = 30
export const PARALLEL_SESSIONS_WIDTH = 1920
export const PARALLEL_SESSIONS_HEIGHT = 1080

const PROJECTS: MockProject[] = [
  {
    name: "super-one",
    active: true,
    expanded: true,
    sessions: [
      { id: "s1", title: "Token-stream the chat mocks", active: true, status: "running", provider: "claude" },
      { id: "s2", title: "Fix relay reconnect bug", status: "running", provider: "codex" },
      { id: "s3", title: "Polish miniapp permissions", status: "background", provider: "claude" },
      { id: "s4", title: "Audit session.send() lock", status: "unseen", pendingReason: "Allow Bash?", provider: "claude" },
      { id: "s5", title: "Worktree merge experiment", status: "background", isWorktree: true, provider: "codex" },
    ],
    hasMore: true,
  },
  {
    name: "marketing-site",
    expanded: true,
    sessions: [
      { id: "ms1", title: "Landing hero rewrite", status: "running", provider: "claude" },
      { id: "ms2", title: "OG image generator", status: "background", provider: "codex" },
    ],
  },
  {
    name: "relay",
    expanded: true,
    sessions: [
      { id: "r1", title: "Durable Object GC pass", status: "background", provider: "claude" },
    ],
  },
]

const RUNNING_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "While the others run — summarize the relay GC change for the changelog.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: `Here's a one-liner for the changelog:

> **Relay:** Durable Objects now sweep idle channels on a per-device ACK, so buffers no longer grow unbounded when a mobile peer drops.

Three other sessions are still streaming in the background — none of them paused while I wrote this.`,
      },
    ],
  },
]

// ── Switcher overlay (Ctrl+Tab) ─────────────────────────────────────────────
interface SwitchRow {
  title: string
  project: string
  provider: "claude" | "codex"
  status: "running" | "background" | "unseen"
}

const SWITCH_ROWS: SwitchRow[] = [
  { title: "Token-stream the chat mocks", project: "super-one", provider: "claude", status: "running" },
  { title: "Fix relay reconnect bug", project: "super-one", provider: "codex", status: "running" },
  { title: "Audit session.send() lock", project: "super-one", provider: "claude", status: "unseen" },
  { title: "Landing hero rewrite", project: "marketing-site", provider: "claude", status: "running" },
  { title: "Durable Object GC pass", project: "relay", provider: "claude", status: "background" },
]

const STATUS_TINT: Record<SwitchRow["status"], string> = {
  running: "oklch(0.65 0.16 42)",
  background: "oklch(0.6 0.02 60)",
  unseen: "oklch(0.6 0.15 152)",
}

function SwitcherOverlay({ frame }: { frame: number }): React.ReactNode {
  const opacity = fadeWindow(frame, sec(0.7), sec(6.2), sec(0.35))
  if (opacity <= 0.001) return null
  const pop = interpolate(frame, [sec(0.7), sec(1.05)], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  // Selection steps down the list as Ctrl+Tab is tapped.
  const selected = Math.min(
    SWITCH_ROWS.length - 1,
    frame < sec(2.0) ? 0 : frame < sec(3.0) ? 1 : frame < sec(4.2) ? 2 : 3,
  )
  return (
    <>
      <AbsoluteFill style={{ background: "rgba(20,15,8,0.36)", opacity }} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "47%",
          transform: `translate(-50%, -50%) scale(${pop})`,
          opacity,
          width: 600,
          padding: 14,
          borderRadius: 20,
          background: "rgba(255,255,255,0.97)",
          border: "1px solid oklch(0.88 0.014 70)",
          boxShadow: "0 40px 90px -24px rgba(30,20,8,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 10px 12px",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "oklch(0.3 0.03 60)" }}>
            Switch session
          </span>
          <span style={{ fontSize: 12, color: "oklch(0.58 0.03 60)" }}>
            8 live across 3 projects
          </span>
        </div>
        {SWITCH_ROWS.map((row, i) => {
          const active = i === selected
          return (
            <div
              key={row.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 12px",
                borderRadius: 12,
                background: active ? "oklch(0.93 0.04 42)" : "transparent",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background:
                    row.provider === "claude"
                      ? "oklch(0.72 0.15 42)"
                      : "oklch(0.66 0.12 165)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {row.provider === "claude" ? "C" : "Cx"}
              </span>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "oklch(0.28 0.03 60)",
                  }}
                >
                  {row.title}
                </span>
                <span style={{ fontSize: 12, color: "oklch(0.58 0.03 60)" }}>{row.project}</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: STATUS_TINT[row.status],
                }}
              >
                {row.status}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Beat A — the parallel sidebar ───────────────────────────────────────────
function BeatSidebar(): React.ReactNode {
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.05, x: 0.1, y: 0.35 },
          { frame: sec(5.4), scale: 1.2, x: 0.08, y: 0.5 },
        ]}
      >
        <ChatMock
          title="Token-stream the chat mocks"
          harness="claude"
          messages={RUNNING_CHAT}
          fps={PARALLEL_SESSIONS_FPS}
          projects={PROJECTS}
          showFooter={false}
        />
      </AppStage>
      <Caption
        text="Run a dozen agents at once — across every project, each in its own session."
        kicker="PARALLEL SESSIONS"
        enter={sec(0.5)}
        exit={sec(5.6)}
      />
    </AbsoluteFill>
  )
}

// ── Beat B — the Ctrl+Tab switcher ──────────────────────────────────────────
function BeatSwitcher(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Token-stream the chat mocks"
          harness="claude"
          messages={RUNNING_CHAT}
          fps={PARALLEL_SESSIONS_FPS}
          projects={PROJECTS}
          showFooter={false}
        />
      </AppStage>
      <SwitcherOverlay frame={frame} />
      <ShortcutHint
        keys={["Ctrl", "Tab"]}
        label="Cycle sessions"
        x={960}
        y={150}
        enter={sec(0.6)}
        exit={sec(5.8)}
        pressAt={sec(2.0)}
      />
      <Caption
        text="Ctrl+Tab jumps between every live session — wherever it lives."
        kicker="ONE KEY · ANY SESSION"
        enter={sec(0.8)}
        exit={sec(6.0)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — switched in, others keep streaming ─────────────────────────────
function BeatKeepStreaming(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Summarize relay GC for changelog"
          harness="claude"
          messages={RUNNING_CHAT}
          frame={frame}
          fps={PARALLEL_SESSIONS_FPS}
          typingCps={92}
          userPauseMs={450}
          assistantPauseMs={380}
          projects={PROJECTS}
        />
      </AppStage>
      <Caption
        text="Switch in and the others never paused — every session streams on its own."
        kicker="NOTHING LOSES ITS PLACE"
        enter={sec(0.5)}
        exit={sec(8.4)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(6.0), content: <BeatSidebar /> },
  { durationInFrames: sec(6.6), content: <BeatSwitcher /> },
  { durationInFrames: sec(9.0), content: <BeatKeepStreaming /> },
]

export const PARALLEL_SESSIONS_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const parallelSessionsDefaultProps = {}

export function ParallelSessionsVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={6}
      title={"A dozen agents.\nZero context loss."}
      subtitle="Every project holds as many sessions as you need — running, background or waiting — and Ctrl+Tab jumps between them instantly."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Parallel by default."
    />
  )
}
