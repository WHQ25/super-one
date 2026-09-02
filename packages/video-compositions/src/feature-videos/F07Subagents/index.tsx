// Feature 07 — Subagents: the agent fans work out to a parallel team.

import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion"
import {
  ChatMock,
  SubagentBlockMock,
  HARNESS_CLAUDE_HUE,
  type MockMessage,
  type SubagentBlockState,
  type SubagentChildToolMock,
  type SubagentColorName,
} from "@superone/desktop-mocks"
import {
  AppStage,
  Caption,
  FeatureVideo,
  featureVideoDuration,
  sec,
  type FeatureBeat,
} from "../../feature-kit/index"

export const SUBAGENTS_FPS = 30
export const SUBAGENTS_WIDTH = 1920
export const SUBAGENTS_HEIGHT = 1080

interface AgentSpec {
  color: SubagentColorName
  type: string
  description: string
  tools: SubagentChildToolMock[]
  result: string
}

const AGENTS: AgentSpec[] = [
  {
    color: "blue",
    type: "code-reviewer",
    description: "Review the relay diff",
    tools: [
      {
        spec: {
          variant: "read",
          filePath: "apps/relay/src/session.ts",
          lineRange: "L40–L96",
          preview: "ackBuffer(seq: number, deviceId: string) {\n  this.pending.get(seq)?.delete(deviceId)\n}",
        },
        expanded: true,
      },
    ],
    result: "No blockers. One nit: `ackBuffer` should early-return when `seq` is unknown.",
  },
  {
    color: "purple",
    type: "general-purpose",
    description: "Audit buffer GC callers",
    tools: [
      {
        spec: {
          variant: "grep",
          pattern: "ackBuffer|forcedDropSeq",
          path: "apps/relay/src",
          matches:
            "session.ts:58  ackBuffer(seq, deviceId)\nsession.ts:73  if (seq <= forcedDropSeq) ...\nrouter.ts:120  room.ackBuffer(frame.seq, id)",
        },
        expanded: true,
      },
    ],
    result: "3 call sites — all route through `ackBuffer`. Safe to add the early-return centrally.",
  },
  {
    color: "green",
    type: "test-runner",
    description: "Run the relay suite",
    tools: [
      {
        spec: {
          variant: "bash",
          command: "bun run test:relay",
          output: "✓ buffer-gc.test.ts (9 passed)\n✓ ack-protocol.test.ts (14 passed)\n\n23 passed · 0.6s",
        },
        expanded: true,
      },
    ],
    result: "Suite green — 23 passed. Coverage on the GC path holds.",
  },
]

interface Phase {
  state: SubagentBlockState
  tools: SubagentChildToolMock[]
  result?: string
  elapsedSec: number
  inTok: number
  outTok: number
}

function phaseOf(agentIndex: number, t: number): Phase {
  const spec = AGENTS[agentIndex]
  const start = 0.4 + agentIndex * 0.5
  const local = t - start
  if (local < 0.9) {
    return { state: "spawning", tools: [], elapsedSec: 0, inTok: 0, outTok: 0 }
  }
  const done = 5.6 + agentIndex * 0.6
  if (t < done) {
    return {
      state: "running",
      tools: spec.tools.map((tool) => ({ ...tool, isStreaming: true })),
      elapsedSec: Math.max(1, Math.floor(local)),
      inTok: Math.round(2400 + local * 1600),
      outTok: Math.round(120 + local * 190),
    }
  }
  return {
    state: "complete",
    tools: spec.tools,
    result: spec.result,
    elapsedSec: Math.round(done - start),
    inTok: 11200 + agentIndex * 900,
    outTok: 1180 + agentIndex * 140,
  }
}

function buildMessages(frame: number, fps: number): MockMessage[] {
  const t = frame / fps
  const subBlocks = AGENTS.map((spec, i) => {
    const phase = phaseOf(i, t)
    return {
      type: "custom" as const,
      cost: 1,
      node: (
        <SubagentBlockMock
          key={spec.type}
          color={spec.color}
          state={phase.state}
          expanded
          subagentType={phase.state === "spawning" ? undefined : spec.type}
          description={phase.state === "spawning" ? undefined : spec.description}
          childTools={phase.tools}
          resultText={phase.result}
          outputExpanded={phase.result !== undefined && t > 8.0}
          elapsedSec={phase.elapsedSec}
          inputTokens={phase.inTok}
          outputTokens={phase.outTok}
          frame={frame}
          fps={fps}
        />
      ),
    }
  })

  const allComplete = AGENTS.every((_, i) => phaseOf(i, t).state === "complete")

  const blocks: MockMessage["blocks"] = [
    {
      type: "markdown",
      text: "This touches review, call-site auditing and tests — I'll fan it out to three subagents and run them in parallel.",
    },
    ...subBlocks,
  ]
  if (allComplete) {
    blocks.push({
      type: "markdown",
      text: "All three subagents are back. Consensus: add a single early-return in `ackBuffer` — reviewed, audited and test-covered. Want me to apply it?",
    })
  }

  return [
    {
      id: "u1",
      role: "user",
      text: "Review the relay buffer-GC change, audit every caller, and run the suite. Use subagents so my context stays clean.",
    },
    { id: "a1", role: "assistant", blocks },
  ]
}

// ── Beats ───────────────────────────────────────────────────────────────────
// Each beat is its own Sequence, so `useCurrentFrame()` resets to 0. `offsetSec`
// keeps the subagent timeline continuous across the three beats.
function ContinuousBeat({
  caption,
  kicker,
  exitAt,
  offsetSec,
}: {
  caption: string
  kicker: string
  exitAt: number
  offsetSec: number
}): React.ReactNode {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const sceneFrame = frame + Math.round(offsetSec * fps)
  return (
    <AbsoluteFill>
      <AppStage hue={HARNESS_CLAUDE_HUE}>
        <ChatMock
          title="Review relay buffer-GC change"
          harness="claude"
          messages={buildMessages(sceneFrame, fps)}
          frame={sceneFrame}
          fps={SUBAGENTS_FPS}
          typingCps={150}
          userPauseMs={300}
          assistantPauseMs={250}
        />
      </AppStage>
      <Caption text={caption} kicker={kicker} enter={sec(0.5)} exit={exitAt} />
    </AbsoluteFill>
  )
}

const BEATS: FeatureBeat[] = [
  {
    durationInFrames: sec(6.0),
    content: (
      <ContinuousBeat
        caption="One ask, three jobs — the agent spins up a parallel subagent team."
        kicker="DELEGATION"
        exitAt={sec(5.6)}
        offsetSec={0}
      />
    ),
  },
  {
    durationInFrames: sec(6.0),
    content: (
      <ContinuousBeat
        caption="Each subagent runs on its own context budget — your main thread stays clean."
        kicker="PARALLEL · ISOLATED"
        exitAt={sec(5.6)}
        offsetSec={6.0}
      />
    ),
  },
  {
    durationInFrames: sec(7.0),
    content: (
      <ContinuousBeat
        caption="Results stream back and merge into one answer you can act on."
        kicker="ONE MERGED ANSWER"
        exitAt={sec(6.6)}
        offsetSec={12.0}
      />
    ),
  },
]

export const SUBAGENTS_DURATION_IN_FRAMES = featureVideoDuration(BEATS)
export const subagentsDefaultProps = {}

export function SubagentsVideo(): React.ReactNode {
  return (
    <FeatureVideo
      index={7}
      title={"Delegate to\na subagent team."}
      subtitle="The agent fans complex work out to parallel subagents — each isolated, each on its own context budget — then merges their findings into one answer."
      hue={HARNESS_CLAUDE_HUE}
      beats={BEATS}
      outroTagline="One prompt, a whole team."
    />
  )
}
