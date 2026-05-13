import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  SubagentBlockMock,
  type Harness,
  type MockMessage,
  type SubagentBlockState,
  type SubagentChildToolMock,
} from "@superone/desktop-mocks"

export const SUBAGENT_FPS = 30
export const SUBAGENT_WIDTH = 1280
export const SUBAGENT_HEIGHT = 800
export const SUBAGENT_DURATION_IN_FRAMES = 16 * SUBAGENT_FPS

export type SubagentSceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

export const subagentSceneDefaultProps: SubagentSceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const TASK_PROMPT = [
  "Investigate why session.send() is being called from outside the lock check path.",
  "",
  "Specifically check src/main/session/session.ts and any IPC handlers that bypass the lock.",
  "Report findings with file:line references.",
].join("\n")

const RESULT_TEXT = [
  "Found 3 callers of `session.send()`:",
  "",
  "- `src/main/ipc/agent-ipc.ts:142` — lock-checked",
  "- `src/main/ipc/agent-ipc.ts:201` — **BYPASSES lock** (the bug)",
  "- `src/main/codex/codex-experiment-service.ts:78` — lock-checked",
].join("\n")

const CHILD_TOOLS_BASE: SubagentChildToolMock[] = [
  {
    spec: {
      variant: "read",
      filePath: "apps/desktop/src/main/session/session.ts",
      lineRange: "L1–L220",
      preview:
        "export class Session {\n  send(message: AgentEvent): void {\n    if (this.locked) throw new SessionLockedError()\n    this.backend.send(message)\n  }\n}",
    },
    expanded: false,
  },
  {
    spec: {
      variant: "grep",
      pattern: "session\\.send",
      path: "apps/desktop/src/main",
      matches:
        "ipc/agent-ipc.ts:142  if (session.isOwnedBy(deviceId)) session.send(msg)\nipc/agent-ipc.ts:201  session.send(msg)\ncodex/codex-experiment-service.ts:78  await ensureRemoteOwnership(...); session.send(msg)",
    },
    expanded: true,
  },
  {
    spec: {
      variant: "edit",
      filePath: "apps/desktop/src/main/ipc/agent-ipc.ts",
      startLine: 198,
      oldText: "session.send(message)",
      newText:
        "if (session.isOwnedBy(deviceId)) {\n  session.send(message)\n} else {\n  throw new SessionLockedError()\n}",
    },
    expanded: true,
  },
]

interface Phase {
  state: SubagentBlockState
  childTools: SubagentChildToolMock[]
  elapsedSec: number
  inputTokens: number
  outputTokens: number
  resultText?: string
  outputExpanded?: boolean
}

function phaseAt(t: number): Phase {
  if (t < 2.2) {
    return {
      state: "spawning",
      childTools: [],
      elapsedSec: Math.max(0, Math.floor(t)),
      inputTokens: 0,
      outputTokens: 0,
    }
  }
  if (t < 4.6) {
    return {
      state: "running",
      childTools: [{ ...CHILD_TOOLS_BASE[0], isStreaming: true, expanded: true }],
      elapsedSec: Math.floor(t - 2.2 + 2),
      inputTokens: Math.round(interpolate(t, [2.2, 4.6], [3200, 7800])),
      outputTokens: Math.round(interpolate(t, [2.2, 4.6], [180, 520])),
    }
  }
  if (t < 7.6) {
    return {
      state: "running",
      childTools: [
        CHILD_TOOLS_BASE[0],
        { ...CHILD_TOOLS_BASE[1], isStreaming: true, expanded: true },
      ],
      elapsedSec: Math.floor(t - 2.2 + 2),
      inputTokens: Math.round(interpolate(t, [4.6, 7.6], [7800, 12400])),
      outputTokens: Math.round(interpolate(t, [4.6, 7.6], [520, 980])),
    }
  }
  if (t < 11.0) {
    return {
      state: "running",
      childTools: [
        CHILD_TOOLS_BASE[0],
        CHILD_TOOLS_BASE[1],
        { ...CHILD_TOOLS_BASE[2], isStreaming: true, expanded: true },
      ],
      elapsedSec: Math.floor(t - 2.2 + 2),
      inputTokens: Math.round(interpolate(t, [7.6, 11.0], [12400, 16800])),
      outputTokens: Math.round(interpolate(t, [7.6, 11.0], [980, 1620])),
    }
  }
  return {
    state: "complete",
    childTools: CHILD_TOOLS_BASE,
    elapsedSec: 11,
    inputTokens: 16800,
    outputTokens: 1820,
    resultText: RESULT_TEXT,
    outputExpanded: t >= 13.0,
  }
}

export const SubagentScene = ({ harness, brandHue, darkMode }: SubagentSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  const phase = phaseAt(t)

  const subagentBlock = (
    <SubagentBlockMock
      color="blue"
      state={phase.state}
      expanded
      subagentType={phase.state === "spawning" ? undefined : "general-purpose"}
      description={phase.state === "spawning" ? undefined : "Audit session.send() callers"}
      prompt={phase.state === "spawning" ? undefined : TASK_PROMPT}
      promptExpanded={false}
      childTools={phase.childTools}
      resultText={phase.resultText}
      outputExpanded={phase.outputExpanded}
      elapsedSec={phase.elapsedSec}
      inputTokens={phase.inputTokens}
      outputTokens={phase.outputTokens}
      frame={frame}
      fps={fps}
    />
  )

  const messages: MockMessage[] = [
    {
      id: "u1",
      role: "user",
      text: "Find every caller of `session.send()` that bypasses the lock. Use a subagent so I keep my own tokens free.",
    },
    {
      id: "a1",
      role: "assistant",
      blocks: [
        {
          type: "markdown",
          text:
            "Delegating to a `general-purpose` subagent — it'll grep for callers, read the lock site, and propose a fix.",
        },
        { type: "custom", node: subagentBlock, cost: 1 },
      ],
    },
  ]

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
          style={{ width: 1232, height: 752 }}
        >
          <ChatMock
            title="Audit session.send() lock bypass"
            harness={harness}
            messages={messages}
            frame={frame}
            fps={fps}
            typingCps={140}
            userPauseMs={250}
            assistantPauseMs={200}
            showTrafficLights
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
