import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  PermissionPromptMock,
  type Harness,
  type MockMessage,
} from "@superone/desktop-mocks"

export const TOOL_BLOCK_FPS = 30
export const TOOL_BLOCK_WIDTH = 1280
export const TOOL_BLOCK_HEIGHT = 800
export const TOOL_BLOCK_DURATION_IN_FRAMES = 12 * TOOL_BLOCK_FPS

export type ToolBlockSceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

export const toolBlockSceneDefaultProps: ToolBlockSceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const MESSAGES: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Run `bun test` and tell me what fails.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      { type: "markdown", text: "Running the test suite now." },
      {
        type: "tool",
        cost: 140,
        expanded: true,
        spec: {
          variant: "bash",
          command: "bun test",
          output:
            "✓ session.test.ts (12 passed)\n✓ chat-store.test.ts (8 passed)\n✗ permission-flow.test.ts (1 failed)\n  └ expected pendingPermissions to be empty after deny()\n\n21 passed | 1 failed | 0.42s",
        },
      },
      {
        type: "markdown",
        text:
          "`permission-flow.test.ts` fails — it expects `pendingPermissions` to clear right after `deny()`, but the new flow keeps the request until the SDK acknowledges.",
      },
      {
        type: "tool",
        cost: 120,
        expanded: true,
        spec: {
          variant: "edit",
          filePath: "src/main/session/session.ts",
          startLine: 312,
          oldText: "this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== id)",
          newText:
            "this.pendingPermissions = this.pendingPermissions.map((p) => (\n  p.id === id ? { ...p, status: 'denying' } : p\n))",
        },
      },
      { type: "markdown", text: "After the SDK confirms, we drop the entry. Tests pass." },
    ],
  },
]

export const ToolBlockScene = ({ harness, brandHue, darkMode }: ToolBlockSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  const permissionVisible = t >= 2.2 && t < 5.2
  const promptOpacity = interpolate(
    t,
    [2.2, 2.55, 5.2, 5.55],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
          style={{ width: 1232, height: 752 }}
        >
          <ChatMock
            title="Investigate permission-flow.test failure"
            harness={harness}
            messages={MESSAGES}
            frame={frame}
            fps={fps}
            typingCps={95}
            showTrafficLights
            permissionPrompt={
              permissionVisible ? (
                <div style={{ opacity: promptOpacity }}>
                  <PermissionPromptMock
                    spec={{ variant: "bash", command: "bun test" }}
                    description="run the test suite once"
                    focusedAction="allow"
                  />
                </div>
              ) : undefined
            }
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
