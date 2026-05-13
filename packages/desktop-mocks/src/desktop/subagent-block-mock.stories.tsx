import type { Meta, StoryObj } from "@storybook/react-vite"
import { SubagentBlockMock, SUBAGENT_COLOR_POOL } from "./subagent-block-mock"

const meta: Meta<typeof SubagentBlockMock> = {
  title: "Desktop Mocks/SubagentBlockMock",
  component: SubagentBlockMock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 720 }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof SubagentBlockMock>

const TASK_PROMPT = [
  "Investigate why session.send() is being called from outside the lock check path.",
  "",
  "Specifically check src/main/session/session.ts and any IPC handlers that bypass the lock.",
  "Report findings with file:line references.",
].join("\n")

const CHILDREN_BASIC = [
  {
    spec: {
      variant: "read" as const,
      filePath: "apps/desktop/src/main/session/session.ts",
      lineRange: "L1–L220",
    },
  },
  {
    spec: {
      variant: "grep" as const,
      pattern: "session\\.send",
      path: "apps/desktop/src/main",
      matches:
        "ipc/agent-ipc.ts:142 (lock-checked)\nipc/agent-ipc.ts:201 (BYPASSES lock)\ncodex/codex-experiment-service.ts:78",
    },
  },
  {
    spec: {
      variant: "edit" as const,
      filePath: "apps/desktop/src/main/ipc/agent-ipc.ts",
      startLine: 198,
      oldText: "session.send(message)",
      newText:
        "if (session.isOwnedBy(deviceId)) session.send(message)\nelse throw new SessionLockedError()",
    },
  },
]

const RESULT_TEXT = [
  "Found 3 callers of `session.send()`:",
  "",
  "- `src/main/ipc/agent-ipc.ts:142` — lock-checked",
  "- `src/main/ipc/agent-ipc.ts:201` — **BYPASSES lock** (the bug)",
  "- `src/main/codex/codex-experiment-service.ts:78` — lock-checked",
  "",
  "Fixed by adding `ensureRemoteOwnership` guard before `session.send()` at line 201.",
].join("\n")

export const Spawning: Story = {
  args: {
    state: "spawning",
  },
}

export const Running: Story = {
  args: {
    state: "running",
    expanded: true,
    subagentType: "general-purpose",
    description: "Audit session.send() callers",
    prompt: TASK_PROMPT,
    childTools: CHILDREN_BASIC.slice(0, 2).map((c, i) => ({
      ...c,
      isStreaming: i === 1,
      expanded: i === 1,
    })),
    elapsedSec: 18,
    color: "blue",
  },
}

export const Complete: Story = {
  args: {
    state: "complete",
    expanded: true,
    subagentType: "general-purpose",
    description: "Audit session.send() callers",
    prompt: TASK_PROMPT,
    childTools: CHILDREN_BASIC,
    resultText: RESULT_TEXT,
    outputExpanded: true,
    elapsedSec: 42,
    inputTokens: 18420,
    outputTokens: 1820,
    color: "purple",
  },
}

export const Collapsed: Story = {
  args: {
    state: "complete",
    expanded: false,
    subagentType: "code-reviewer",
    description: "Review chat permission flow PR",
    elapsedSec: 38,
    inputTokens: 8200,
    outputTokens: 1240,
    toolCallCount: 6,
    color: "rose",
  },
}

export const AsyncBackground: Story = {
  args: {
    state: "running",
    expanded: true,
    async: true,
    subagentType: "general-purpose",
    description: "Rebuild SDK and rerun integration tests",
    prompt: "Rebuild the SDK and rerun the integration suite. Report any failures.",
    liveActivityText:
      "Running integration test suite (3/12) — currently in `apps/desktop/src/test/integration/permission-flow.test.ts`",
    asyncToolHistory: [
      { toolName: "Bash", description: "bun install --frozen-lockfile" },
      { toolName: "Bash", description: "bun run build" },
      { toolName: "Bash", description: "bun test apps/desktop/src/test/integration/session" },
      { toolName: "Bash", description: "bun test apps/desktop/src/test/integration/permission", isActive: true },
    ],
    summary: "Started 14s ago. Cached install, fresh build, 3/12 tests run so far.",
    elapsedSec: 14,
    totalTokens: 14320,
    toolCallCount: 8,
    color: "teal",
  },
}

export const AllColors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {SUBAGENT_COLOR_POOL.map((c) => (
        <SubagentBlockMock
          key={c}
          color={c}
          state="complete"
          expanded
          subagentType={c}
          description={`A finished subagent in the ${c} palette slot`}
          childTools={CHILDREN_BASIC.slice(0, 2)}
          elapsedSec={32 + SUBAGENT_COLOR_POOL.indexOf(c) * 4}
          inputTokens={6200 + SUBAGENT_COLOR_POOL.indexOf(c) * 480}
          outputTokens={780 + SUBAGENT_COLOR_POOL.indexOf(c) * 60}
        />
      ))}
    </div>
  ),
}
