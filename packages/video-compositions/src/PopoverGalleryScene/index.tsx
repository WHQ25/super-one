import { useMemo, type ReactNode } from "react"
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatMock,
  ChatStatusBarMock,
  CodexPermissionPopoverMock,
  EffortSelectorPopoverMock,
  GitBranchPopoverMock,
  HARNESS_CLAUDE_HUE,
  ModelEffortTriggerStrip,
  ModelSelectorPopoverMock,
  PermissionModePopoverMock,
  SandboxModePopoverMock,
  WorktreePopoverMock,
  type ChatStatusBarMockProps,
  type Harness,
  type ModelEffortTriggerStripProps,
  type MockMessage,
} from "@superone/desktop-mocks"

export const POPOVER_GALLERY_FPS = 30
export const POPOVER_GALLERY_WIDTH = 1280
export const POPOVER_GALLERY_HEIGHT = 800

export type PopoverGallerySceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

interface Stage {
  title: string
  popover: ReactNode
  statusBar: ChatStatusBarMockProps
  modelEffort: ModelEffortTriggerStripProps
  anchor:
    | "branch"
    | "permission"
    | "sandbox"
    | "codex-permission"
    | "workdir"
    | "model"
    | "effort"
}

const STAGES: Stage[] = [
  {
    title: "Select Model",
    popover: <ModelSelectorPopoverMock activeId="claude-opus-4-8" />,
    statusBar: {},
    modelEffort: { activeTrigger: "model" },
    anchor: "model",
  },
  {
    title: "Thinking Effort",
    popover: <EffortSelectorPopoverMock activeLevel="xhigh" />,
    statusBar: {},
    modelEffort: { activeTrigger: "effort" },
    anchor: "effort",
  },
  {
    title: "Permission Mode · Plan",
    popover: <PermissionModePopoverMock activeId="plan" />,
    statusBar: {
      permission: { id: "plan", label: "Plan Mode" },
      activeTrigger: "permission",
    },
    modelEffort: {},
    anchor: "permission",
  },
  {
    title: "Sandbox · Auto",
    popover: <SandboxModePopoverMock activeId="auto" />,
    statusBar: {
      sandbox: "auto",
      activeTrigger: "sandbox",
    },
    modelEffort: {},
    anchor: "sandbox",
  },
  {
    title: "Git branch",
    popover: (
      <GitBranchPopoverMock
        current="main"
        dirty={{ files: 18, insertions: 426, deletions: 191 }}
        search=""
      />
    ),
    statusBar: { activeTrigger: "branch" },
    modelEffort: {},
    anchor: "branch",
  },
  {
    title: "Worktree picker",
    popover: <WorktreePopoverMock />,
    statusBar: { activeTrigger: "workdir" },
    modelEffort: {},
    anchor: "workdir",
  },
  {
    title: "Codex permission preset",
    popover: <CodexPermissionPopoverMock activeId="default" />,
    statusBar: {
      harness: "codex",
      activeTrigger: "codex-permission",
    },
    modelEffort: { modelLabel: "GPT5.6 Sol", effortLabel: "Extra High" },
    anchor: "codex-permission",
  },
]

const STAGE_SECONDS = 3
export const POPOVER_GALLERY_DURATION_IN_FRAMES = STAGES.length * STAGE_SECONDS * POPOVER_GALLERY_FPS

export const popoverGallerySceneDefaultProps: PopoverGallerySceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: true,
}

const BASE_MESSAGES: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Walk me through every popover in the chat status bar — I want to see them all in one shot.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text:
          "Sure — flipping through each one. Use these to switch models, change thinking effort, control permissions, swap sandboxes, hop branches, or jump into a worktree.",
      },
    ],
  },
]

// Anchor offsets are measured **from the bottom-left of the stage frame**.
// They roughly mirror where each trigger sits in the real chat layout.
const ANCHOR_OFFSETS: Record<Stage["anchor"], { left: number; bottom: number }> = {
  workdir: { left: 28, bottom: 64 },
  branch: { left: 132, bottom: 64 },
  permission: { left: 256, bottom: 64 },
  sandbox: { left: 1100, bottom: 64 },
  "codex-permission": { left: 1100, bottom: 64 },
  model: { left: 90, bottom: 152 },
  effort: { left: 90, bottom: 152 },
}

export const PopoverGalleryScene = ({ harness, brandHue, darkMode }: PopoverGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const idx = Math.min(STAGES.length - 1, Math.floor(t / STAGE_SECONDS))
  const stage = STAGES[idx]

  const localT = t - idx * STAGE_SECONDS
  const popoverOpacity = interpolate(
    localT,
    [0, 0.25, STAGE_SECONDS - 0.25, STAGE_SECONDS],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const popoverYOffset = interpolate(localT, [0, 0.35], [8, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const stageHarness = stage.statusBar.harness ?? harness
  const messages = useMemo(() => BASE_MESSAGES, [])
  const anchor = ANCHOR_OFFSETS[stage.anchor]

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752, opacity: shellOpacity }}
          className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <ChatMock
            title={stage.title}
            harness={stageHarness}
            messages={messages}
            placeholder="Click a status-bar trigger to switch model, effort, mode, sandbox…"
            showTrafficLights
          />

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 border-t border-border/60 bg-card/95 px-4 pt-2 pb-1 backdrop-blur"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
              <ModelEffortTriggerStrip {...stage.modelEffort} />
              <div className="text-[10px] text-muted-foreground">{stage.title}</div>
            </div>
            <ChatStatusBarMock harness={stageHarness} {...stage.statusBar} className="mx-auto w-full max-w-3xl px-0" />
          </div>

          <div
            style={{
              position: "absolute",
              left: anchor.left,
              bottom: anchor.bottom,
              opacity: popoverOpacity,
              transform: `translateY(${popoverYOffset}px)`,
            }}
          >
            {stage.popover}
          </div>
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
