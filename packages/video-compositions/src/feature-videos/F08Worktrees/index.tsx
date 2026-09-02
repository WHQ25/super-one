// Feature 08 — Git Worktrees: every risky change gets its own branch + folder.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion"
import {
  ChatMock,
  WorktreePopoverMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
  type MockProject,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  Cursor,
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

export const WORKTREES_FPS = 30
export const WORKTREES_WIDTH = 1920
export const WORKTREES_HEIGHT = 1080

const STAGE = makeStage()

const RISKY_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Try swapping the relay buffer to a ring buffer — but don't risk my main checkout.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "Good call — this is an experiment. I'll spin it up in a **git worktree** so your `main` working copy stays untouched. New branch `exp/ring-buffer`, its own folder.",
      },
      {
        type: "tool",
        cost: 100,
        expanded: true,
        spec: {
          variant: "bash",
          command: "git worktree add ../super-one-ring exp/ring-buffer",
          output:
            "Preparing worktree (new branch 'exp/ring-buffer')\n✓ ../super-one-ring  →  exp/ring-buffer\nHEAD is now at 9a5f062f",
        },
      },
      {
        type: "markdown",
        text: "Worktree ready. This session is now isolated — edits here never touch `main`.",
      },
    ],
  },
]

const WORKTREE_PROJECTS: MockProject[] = [
  {
    name: "super-one",
    active: true,
    expanded: true,
    sessions: [
      { id: "s1", title: "Refactor sidebar layout", status: "running", provider: "claude" },
      { id: "s2", title: "Ring buffer experiment", active: true, status: "running", isWorktree: true, provider: "claude" },
      { id: "s3", title: "Upgrade React 19.3", status: "background", isWorktree: true, provider: "codex" },
      { id: "s4", title: "Fix relay reconnect bug", status: "idle", provider: "codex" },
    ],
  },
]

// ── Beat A — open the worktree popover ──────────────────────────────────────
function BeatOpenPopover(): React.ReactNode {
  const frame = useCurrentFrame()
  const branchBtn = { x: mapX(STAGE, 360), y: mapY(STAGE, 762) }
  const popOpacity = fadeWindow(frame, sec(4.0), sec(8.4), sec(0.35))
  const popPop = interpolate(frame, [sec(4.0), sec(4.4)], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Ring buffer experiment"
          harness="claude"
          messages={RISKY_CHAT}
          frame={frame}
          fps={WORKTREES_FPS}
          typingCps={150}
          userPauseMs={350}
          assistantPauseMs={300}
        />
      </AppStage>
      <Cursor
        path={[
          { frame: sec(1.6), x: 940, y: 520 },
          { frame: sec(3.8), x: branchBtn.x, y: branchBtn.y },
          { frame: sec(4.1), x: branchBtn.x, y: branchBtn.y, click: true },
        ]}
      />
      <div
        style={{
          position: "absolute",
          left: branchBtn.x - 40,
          top: branchBtn.y - 372,
          opacity: popOpacity,
          transform: `scale(${popPop})`,
          transformOrigin: "left bottom",
        }}
      >
        <WorktreePopoverMock
          baseHeading="Create worktree from"
          entries={[
            { branch: "exp/ring-buffer", shortHead: "9a5f062", dirtyFiles: 3 },
            { branch: "upgrade/react-19-3", shortHead: "34e15e8" },
          ]}
          branches={["main", "fix/relay-reconnect", "release/0.38.x"]}
        />
      </div>
      <Caption
        text="Risky experiment? The agent runs it in a git worktree — a real branch in its own folder."
        kicker="GIT WORKTREES"
        enter={sec(0.5)}
        exit={sec(8.6)}
      />
    </AbsoluteFill>
  )
}

// ── Beat B — the worktree session in the sidebar ────────────────────────────
function BeatSidebar(): React.ReactNode {
  return (
    <AbsoluteFill>
      <AppStage
        hue={HARNESS_CLAUDE_HUE}
        zoom={[
          { frame: 0, scale: 1.06, x: 0.1, y: 0.3 },
          { frame: sec(4.8), scale: 1.22, x: 0.09, y: 0.4 },
        ]}
      >
        <ChatMock
          title="Ring buffer experiment"
          harness="claude"
          messages={RISKY_CHAT}
          fps={WORKTREES_FPS}
          projects={WORKTREE_PROJECTS}
          showFooter={false}
        />
      </AppStage>
      <Caption
        text="Worktree sessions are tagged in the sidebar — main and experiments, side by side."
        kicker="ISOLATED · VISIBLE"
        enter={sec(0.5)}
        exit={sec(5.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — experiment runs safely ─────────────────────────────────────────
function BeatSafe(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Ring buffer experiment"
          harness="claude"
          messages={RISKY_CHAT}
          frame={frame + sec(5)}
          fps={WORKTREES_FPS}
          typingCps={150}
          userPauseMs={350}
          assistantPauseMs={300}
          projects={WORKTREE_PROJECTS}
        />
      </AppStage>
      <Caption
        text="Merge it if it works, delete it if it doesn't — your main checkout never moved."
        kicker="EXPERIMENT WITHOUT FEAR"
        enter={sec(0.5)}
        exit={sec(6.4)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(9.2), content: <BeatOpenPopover /> },
  { durationInFrames: sec(6.0), content: <BeatSidebar /> },
  { durationInFrames: sec(7.0), content: <BeatSafe /> },
]

export const WORKTREES_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const worktreesDefaultProps = {}

export function WorktreesVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={8}
      title={"Experiment\nwithout fear."}
      subtitle="SuperOne runs risky changes in real git worktrees — isolated branches in their own folders, so your main checkout is never at stake."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Every branch, its own world."
    />
  )
}
