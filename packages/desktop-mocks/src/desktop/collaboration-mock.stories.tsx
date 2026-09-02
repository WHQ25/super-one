import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  BrowserCloseResultMock,
  CollaborationMock,
  type CollaborationAgentMock,
  type CollaborationEventMock,
} from "./collaboration-mock"

const meta: Meta<typeof CollaborationMock> = {
  title: "Desktop Mocks/CollaborationMock",
  component: CollaborationMock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 760 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof CollaborationMock>

export const CrossHarnessRunning: Story = {}

const HANDOFF_EVENTS: CollaborationEventMock[] = [
  {
    id: "spawn",
    mode: "spawn",
    target: "Implementation agent",
    harness: "codex",
    summary: "completed component and scoped verification",
    status: "complete",
  },
  {
    id: "link",
    mode: "link",
    target: "Design audit",
    harness: "cursor",
    summary: "linked findings received",
    status: "complete",
  },
  {
    id: "wait",
    mode: "wait",
    target: "All agents",
    summary: "3 replies collected",
    status: "complete",
  },
  {
    id: "handoff",
    mode: "handoff",
    target: "Release captain",
    harness: "dsh",
    summary: "final review now owns the turn",
    status: "complete",
  },
]

const HANDOFF_AGENTS: CollaborationAgentMock[] = [
  {
    id: "implementation",
    name: "Implementation agent",
    harness: "codex",
    role: "Implementer",
    task: "Build all requested mock components",
    status: "complete",
    subtasks: [
      { id: "turn", title: "Turn details mock", status: "complete" },
      { id: "collab", title: "Collaboration mock", status: "complete" },
    ],
  },
  {
    id: "design",
    name: "Design audit",
    harness: "cursor",
    role: "Linked session",
    task: "Verify hierarchy, labels, and compact states",
    status: "complete",
    subtasks: [{ id: "visual", title: "Visual review", status: "complete" }],
  },
  {
    id: "captain",
    name: "Release captain",
    harness: "dsh",
    role: "Handoff",
    task: "Own the final package verification and release summary",
    status: "running",
    subtasks: [{ id: "final", title: "Final package typecheck", status: "running" }],
  },
]

export const HandoffComplete: Story = {
  args: {
    title: "Release handoff",
    events: HANDOFF_EVENTS,
    agents: HANDOFF_AGENTS,
  },
}

export const BrowserCloseSuccess: Story = {
  render: () => (
    <BrowserCloseResultMock closedTabs={["SuperOne docs", "Storybook", "Release preview"]} />
  ),
}

export const BrowserClosePartialFailure: Story = {
  render: () => (
    <BrowserCloseResultMock
      closedTabs={["SuperOne docs", "Storybook"]}
      failedTabs={[
        { tab: "stale-tab-7", reason: "Tab is no longer available" },
      ]}
    />
  ),
}

export const BrowserCloseFailed: Story = {
  render: () => (
    <BrowserCloseResultMock
      closedTabs={[]}
      failedTabs={[
        { tab: "user-reading", reason: "Tab belongs to another session" },
        { tab: "stale-tab-7", reason: "Tab is no longer available" },
      ]}
    />
  ),
}

export const BrowserCloseStreaming: Story = {
  render: () => (
    <BrowserCloseResultMock closedTabs={["SuperOne docs", "Storybook", "Release preview"]} streaming />
  ),
}
