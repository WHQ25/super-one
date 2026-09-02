// Feature 09 — Permissions & Sandbox: you set the leash.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion"
import {
  ChatMock,
  PermissionModePopoverMock,
  PermissionPromptMock,
  SandboxModePopoverMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  EASE_OUT,
  FeatureVideo,
  fadeWindow,
  featureVideoDuration,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const PERMISSIONS_FPS = 30
export const PERMISSIONS_WIDTH = 1920
export const PERMISSIONS_HEIGHT = 1080

const ASK_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Clean the build artifacts and reinstall dependencies.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "I'll clear `dist/` and run a fresh install. Both touch your filesystem, so I need a yes first.",
      },
    ],
  },
]

const NET_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Pull the latest release notes from the GitHub API.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "The sandbox blocks outbound network by default — I need approval to reach `api.github.com`.",
      },
    ],
  },
]

const RUN_CHAT: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "You're clear — Accept Edits for this task.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "Switching to **Accept Edits**. Reads and edits now apply without a prompt — I'll still stop for anything destructive.",
      },
      {
        type: "tool",
        cost: 110,
        expanded: true,
        spec: {
          variant: "bash",
          command: "rm -rf dist && bun install",
          output: "removed dist/ (412 files)\n✓ 184 packages installed · 3.1s",
        },
      },
      {
        type: "markdown",
        text: "Clean install done — no interruptions, no surprises.",
      },
    ],
  },
]

// ── Beat A — per-tool permission prompt ─────────────────────────────────────
function BeatAsk(): React.ReactNode {
  const frame = useCurrentFrame()
  const promptOpacity = fadeWindow(frame, sec(2.6), sec(7.4), sec(0.35))
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Clean build & reinstall"
          harness="claude"
          messages={ASK_CHAT}
          frame={frame}
          fps={PERMISSIONS_FPS}
          typingCps={140}
          userPauseMs={350}
          assistantPauseMs={300}
          permissionPrompt={
            promptOpacity > 0.001 ? (
              <div style={{ opacity: promptOpacity }}>
                <PermissionPromptMock
                  spec={{ variant: "bash", command: "rm -rf dist && bun install" }}
                  description="clean build artifacts and reinstall"
                  focusedAction="allow"
                  suggestions={[
                    { label: "Allow bun install for this project", selected: true },
                    { label: "Allow rm in dist/ only" },
                  ]}
                />
              </div>
            ) : undefined
          }
        />
      </AppStage>
      <Caption
        text="Every tool call asks first — with scoped suggestions, not a blank yes/no."
        kicker="PERMISSIONS"
        enter={sec(0.5)}
        exit={sec(7.6)}
      />
    </AbsoluteFill>
  )
}

// ── Beat B — sandbox network prompt ─────────────────────────────────────────
function BeatSandbox(): React.ReactNode {
  const frame = useCurrentFrame()
  const promptOpacity = fadeWindow(frame, sec(2.4), sec(6.8), sec(0.35))
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Fetch GitHub release notes"
          harness="claude"
          messages={NET_CHAT}
          frame={frame}
          fps={PERMISSIONS_FPS}
          typingCps={140}
          userPauseMs={350}
          assistantPauseMs={300}
          permissionPrompt={
            promptOpacity > 0.001 ? (
              <div style={{ opacity: promptOpacity }}>
                <PermissionPromptMock
                  mode="sandbox_network"
                  sandboxNetwork={{ host: "api.github.com" }}
                  description="reach the GitHub API"
                  focusedAction="allow"
                />
              </div>
            ) : undefined
          }
        />
      </AppStage>
      <Caption
        text="Sandbox mode contains the agent — every network host and write needs a yes."
        kicker="SANDBOXED BY DEFAULT"
        enter={sec(0.5)}
        exit={sec(7.0)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — choose a permission mode, then run free ────────────────────────
function BeatModes(): React.ReactNode {
  const frame = useCurrentFrame()
  const popOpacity = fadeWindow(frame, sec(0.6), sec(4.2), sec(0.35))
  const popPop = interpolate(frame, [sec(0.6), sec(1.0)], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  })
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Accept Edits for this task"
          harness="claude"
          messages={RUN_CHAT}
          frame={Math.max(0, frame - sec(3.8))}
          fps={PERMISSIONS_FPS}
          typingCps={150}
          userPauseMs={350}
          assistantPauseMs={300}
        />
      </AppStage>
      <div
        style={{
          position: "absolute",
          left: 612,
          top: 470,
          display: "flex",
          gap: 18,
          opacity: popOpacity,
          transform: `scale(${popPop})`,
          transformOrigin: "center bottom",
        }}
      >
        <PermissionModePopoverMock activeId="acceptEdits" />
        <SandboxModePopoverMock />
      </div>
      <Caption
        text="Dial it yourself — from ask-every-time to full autopilot, per session."
        kicker="YOU SET THE LEASH"
        enter={sec(0.5)}
        exit={sec(8.0)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(8.2), content: <BeatAsk /> },
  { durationInFrames: sec(7.6), content: <BeatSandbox /> },
  { durationInFrames: sec(8.8), content: <BeatModes /> },
]

export const PERMISSIONS_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const permissionsDefaultProps = {}

export function PermissionsVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={9}
      title={"You set\nthe leash."}
      subtitle="Sandboxed by default, SuperOne asks before every tool call — with scoped suggestions — and lets you dial autonomy from cautious to full autopilot."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Autonomy on your terms."
    />
  )
}
