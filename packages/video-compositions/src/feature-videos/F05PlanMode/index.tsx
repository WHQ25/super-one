// Feature 05 — Plan Mode: the agent drafts a plan, you approve, it executes.

import { AbsoluteFill, useCurrentFrame } from "remotion"
import {
  ChatMock,
  PermissionModePopoverMock,
  PlanApprovalMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  Cursor,
  FeatureVideo,
  ShortcutHint,
  fadeWindow,
  featureVideoDuration,
  makeStage,
  mapX,
  mapY,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const PLAN_MODE_FPS = 30
export const PLAN_MODE_WIDTH = 1920
export const PLAN_MODE_HEIGHT = 1080

const STAGE = makeStage()

const PLAN_INTRO: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Refactor the permission lifecycle so denies survive until the SDK acks.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "Plan mode is on — I won't touch any files yet. Let me read the lock path, map every caller, and draft a plan for you to review first.",
      },
      {
        type: "tool",
        cost: 90,
        expanded: false,
        spec: {
          variant: "read",
          filePath: "apps/desktop/src/main/session/session.ts",
          lineRange: "L280–L340",
          preview:
            "deny(id: string) {\n  this.pendingPermissions = this.pendingPermissions\n    .filter((p) => p.id !== id)\n}",
        },
      },
      {
        type: "markdown",
        text: "Found it. Drafting the plan now…",
      },
    ],
  },
]

const PLAN_CONTENT = `## Permission lifecycle: keep denies until the SDK acks

\`deny()\` currently drops the pending entry synchronously, so a slow SDK round-trip leaves the UI and backend disagreeing about state.

### Approach

1. In \`session.ts\`, change \`deny()\` to **mark** the entry \`status: 'denying'\` instead of filtering it out.
2. Drop the entry only on the \`permission_resolved\` event from the SDK.
3. Update \`chat-store.ts\` so the prompt stays visible (greyed) while \`denying\`.
4. Add an integration test: \`deny()\` keeps the request until the ack, then clears it.

### Scope

- \`apps/desktop/src/main/session/session.ts\`
- \`apps/desktop/src/renderer/src/stores/chat-store.ts\`
- new \`permission-deny-lifecycle.test.ts\`

No behavior change for the allow path.`

const EXECUTION: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Approved — go.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text: "Executing the approved plan. Edits are auto-accepted now.",
      },
      {
        type: "tool",
        cost: 130,
        expanded: true,
        spec: {
          variant: "edit",
          filePath: "apps/desktop/src/main/session/session.ts",
          startLine: 312,
          oldText: "this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== id)",
          newText:
            "this.pendingPermissions = this.pendingPermissions.map((p) =>\n  p.id === id ? { ...p, status: 'denying' } : p,\n)",
        },
      },
      {
        type: "tool",
        cost: 120,
        expanded: true,
        spec: {
          variant: "bash",
          command: "bun test permission-deny-lifecycle",
          output: "✓ keeps request until ack\n✓ clears on permission_resolved\n\n2 passed · 0.31s",
        },
      },
      {
        type: "markdown",
        text: "Plan complete — three files touched, exactly as approved. Tests green.",
      },
    ],
  },
]

// ── Beat A — enter plan mode ────────────────────────────────────────────────
function BeatEnterPlan(): React.ReactNode {
  const frame = useCurrentFrame()
  const popOpacity = fadeWindow(frame, sec(1.0), sec(3.6), sec(0.35))
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Refactor permission lifecycle"
          harness="claude"
          messages={PLAN_INTRO}
          frame={frame}
          fps={PLAN_MODE_FPS}
          typingCps={140}
          userPauseMs={350}
          assistantPauseMs={300}
        />
      </AppStage>
      <PlanModePopover opacity={popOpacity} />
      <ShortcutHint
        keys={["⇧", "Tab"]}
        label="Toggle plan mode"
        x={960}
        y={132}
        enter={sec(0.5)}
        exit={sec(3.4)}
        pressAt={sec(1.0)}
      />
      <Caption
        text="Hit Shift+Tab and the agent plans before it touches a single file."
        kicker="PLAN MODE"
        enter={sec(0.5)}
        exit={sec(8.4)}
      />
    </AbsoluteFill>
  )
}

function PlanModePopover({ opacity }: { opacity: number }): React.ReactNode {
  if (opacity <= 0.001) return null
  return (
    <div
      style={{
        position: "absolute",
        left: mapX(STAGE, 470),
        top: mapY(STAGE, 470),
        transform: "translate(-50%, 0)",
        opacity,
      }}
    >
      <PermissionModePopoverMock activeId="plan" />
    </div>
  )
}

// ── Beat B — review and approve the plan ────────────────────────────────────
function BeatApprovePlan(): React.ReactNode {
  const frame = useCurrentFrame()
  const approveBtn = { x: mapX(STAGE, 980), y: mapY(STAGE, 712) }
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Plan review — permission-lifecycle.plan.md"
          harness="claude"
          messages={[]}
          planApproval={
            <PlanApprovalMock
              fileName="permission-lifecycle.plan.md"
              planContent={PLAN_CONTENT}
              allowedPrompts={[
                { tool: "Edit", prompt: "session.ts" },
                { tool: "Edit", prompt: "chat-store.ts" },
                { tool: "Write", prompt: "permission-deny-lifecycle.test.ts" },
              ]}
              switchAfterApproval={frame >= sec(4.6)}
              fastModeTarget="acceptEdits"
              focusedAction="approve"
            />
          }
        />
      </AppStage>
      <Cursor
        path={[
          { frame: sec(1.0), x: 900, y: 560 },
          { frame: sec(4.2), x: approveBtn.x, y: approveBtn.y },
          { frame: sec(4.5), x: approveBtn.x, y: approveBtn.y, click: true },
        ]}
      />
      <Caption
        text="Read the whole plan — scope, files, tests — then approve it in one click."
        kicker="REVIEW BEFORE YOU RUN"
        enter={sec(0.5)}
        exit={sec(7.4)}
      />
    </AbsoluteFill>
  )
}

// ── Beat C — execute the approved plan ──────────────────────────────────────
function BeatExecute(): React.ReactNode {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Executing approved plan"
          harness="claude"
          messages={EXECUTION}
          frame={frame}
          fps={PLAN_MODE_FPS}
          typingCps={150}
          userPauseMs={350}
          assistantPauseMs={300}
        />
      </AppStage>
      <Caption
        text="Approve once and edits auto-apply — the agent runs the exact plan you signed off."
        kicker="EXECUTE WITH CONFIDENCE"
        enter={sec(0.5)}
        exit={sec(8.4)}
      />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  { durationInFrames: sec(9.0), content: <BeatEnterPlan /> },
  { durationInFrames: sec(8.0), content: <BeatApprovePlan /> },
  { durationInFrames: sec(9.0), content: <BeatExecute /> },
]

export const PLAN_MODE_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const planModeDefaultProps = {}

export function PlanModeVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={5}
      title={"Plan first.\nThen execute."}
      subtitle="Shift+Tab into Plan Mode and the agent researches, drafts a reviewable plan, and waits — no file is touched until you approve."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="Approve the plan, not the surprise."
    />
  )
}
