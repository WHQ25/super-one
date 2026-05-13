import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  HARNESS_CLAUDE_HUE,
  SubagentBlockMock,
  SUBAGENT_COLOR_POOL,
  type SubagentChildToolMock,
} from "@superone/desktop-mocks"

export const SUBAGENT_GALLERY_FPS = 30
export const SUBAGENT_GALLERY_WIDTH = 1920
export const SUBAGENT_GALLERY_HEIGHT = 1080
export const SUBAGENT_GALLERY_DURATION_IN_FRAMES = 12 * SUBAGENT_GALLERY_FPS

export type SubagentGallerySceneProps = {
  brandHue: number
  darkMode: boolean
}

export const subagentGallerySceneDefaultProps: SubagentGallerySceneProps = {
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const QUICK_TOOLS: SubagentChildToolMock[] = [
  {
    spec: {
      variant: "read",
      filePath: "apps/desktop/src/main/session/session.ts",
      lineRange: "L1–L220",
    },
  },
  {
    spec: {
      variant: "grep",
      pattern: "session\\.send",
      path: "apps/desktop/src/main",
      matches:
        "ipc/agent-ipc.ts:142  if (session.isOwnedBy(deviceId)) session.send(msg)\nipc/agent-ipc.ts:201  session.send(msg)\ncodex/codex-experiment-service.ts:78  session.send(msg)",
    },
  },
]

const COLOR_DESCRIPTIONS: Record<(typeof SUBAGENT_COLOR_POOL)[number], string> = {
  purple: "Audit session.send() callers",
  blue: "Investigate permission flow",
  cyan: "Profile cold-start latency",
  teal: "Review Codex IPC layer",
  green: "Migrate to R2 distribution",
  amber: "Hunt down flaky test",
  orange: "Spec mobile sync protocol",
  rose: "Refactor brand theme tokens",
}

const COLOR_TYPES: Record<(typeof SUBAGENT_COLOR_POOL)[number], string> = {
  purple: "general-purpose",
  blue: "code-reviewer",
  cyan: "performance-auditor",
  teal: "explorer",
  green: "infra-engineer",
  amber: "test-rescuer",
  orange: "spec-writer",
  rose: "frontend-design",
}

export const SubagentGalleryScene = ({
  brandHue,
  darkMode,
}: SubagentGallerySceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="bg-muted">
        <div className="mx-auto w-full max-w-[1760px] px-12 pt-10 pb-4">
          <div className="mb-2 text-2xl font-semibold text-foreground">Subagent block — color pool</div>
          <div className="text-sm text-muted-foreground">
            Each spawned subagent picks its color from a stable 8-entry palette so concurrent agents stay
            visually distinct.
          </div>
        </div>
        <div className="mx-auto grid w-full max-w-[1760px] flex-1 grid-cols-2 gap-4 px-12 pb-8">
          {SUBAGENT_COLOR_POOL.map((color, idx) => {
            const t = idx * 0.18
            const opacity = interpolate(
              frame,
              [t * fps, (t + 0.45) * fps],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
            const translateY = interpolate(
              frame,
              [t * fps, (t + 0.45) * fps],
              [16, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )

            // Alternate states so each card is a different lifecycle snapshot.
            const isRunning = idx === 2 || idx === 5
            const isAsync = idx === 7

            return (
              <div
                key={color}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
                style={{ opacity, transform: `translateY(${translateY}px)` }}
              >
                <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{color}</span>
                  <span className="rounded bg-muted px-1.5 py-px text-[10px] lowercase">
                    {isAsync ? "async · running" : isRunning ? "running" : "complete"}
                  </span>
                </div>
                <SubagentBlockMock
                  color={color}
                  state={isRunning || isAsync ? "running" : "complete"}
                  async={isAsync}
                  expanded
                  subagentType={COLOR_TYPES[color]}
                  description={COLOR_DESCRIPTIONS[color]}
                  childTools={isAsync ? [] : QUICK_TOOLS}
                  asyncToolHistory={
                    isAsync
                      ? [
                          { toolName: "Bash", description: "bun install --frozen-lockfile" },
                          { toolName: "Bash", description: "bun run build" },
                          { toolName: "Bash", description: "bun test apps/desktop/src/test/integration", isActive: true },
                        ]
                      : []
                  }
                  liveActivityText={
                    isAsync
                      ? "Running integration test suite (3/12) — currently in permission-flow.test.ts"
                      : undefined
                  }
                  elapsedSec={isAsync ? 14 : isRunning ? 12 : 32 + idx * 3}
                  inputTokens={isAsync ? 0 : isRunning ? 4800 : 6200 + idx * 480}
                  outputTokens={isAsync ? 0 : isRunning ? 320 : 780 + idx * 60}
                  totalTokens={isAsync ? 14320 : 0}
                  toolCallCount={isAsync ? 8 : undefined}
                  frame={frame}
                  fps={fps}
                />
              </div>
            )
          })}
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
