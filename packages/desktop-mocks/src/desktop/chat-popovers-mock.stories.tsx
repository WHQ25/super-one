import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ChatStatusBarMock,
  CodexPermissionPopoverMock,
  EffortSelectorPopoverMock,
  GitBranchPopoverMock,
  ModelEffortTriggerStrip,
  ModelSelectorPopoverMock,
  PermissionModePopoverMock,
  SandboxModePopoverMock,
  WorktreePopoverMock,
} from "./chat-popovers-mock"

const meta: Meta = {
  title: "Desktop Mocks/ChatPopovers",
  parameters: { layout: "padded" },
}
export default meta

type Story = StoryObj

export const ModelSelector: Story = {
  render: () => <ModelSelectorPopoverMock />,
}

export const ModelSelectorSonnetActive: Story = {
  render: () => <ModelSelectorPopoverMock activeId="sonnet-4-6" />,
}

export const EffortSelectorXHigh: Story = {
  render: () => <EffortSelectorPopoverMock activeLevel="xhigh" />,
}

export const EffortSelectorMax: Story = {
  render: () => <EffortSelectorPopoverMock activeLevel="max" />,
}

export const PermissionMode: Story = {
  render: () => <PermissionModePopoverMock activeId="default" />,
}

export const PermissionModePlan: Story = {
  render: () => <PermissionModePopoverMock activeId="plan" />,
}

export const PermissionModeAutoBlocked: Story = {
  render: () => (
    <PermissionModePopoverMock
      activeId="default"
      autoBlockedMessage="Auto mode requires a Pro subscription on Opus."
    />
  ),
}

export const SandboxModeOn: Story = {
  render: () => <SandboxModePopoverMock activeId="on" />,
}

export const SandboxModeAuto: Story = {
  render: () => <SandboxModePopoverMock activeId="auto" />,
}

export const SandboxModeNotReady: Story = {
  render: () => (
    <SandboxModePopoverMock
      activeId="on"
      notReadyHint="Sandbox runtime not ready · open Settings"
    />
  ),
}

export const CodexPermissionDefault: Story = {
  render: () => <CodexPermissionPopoverMock activeId="default" />,
}

export const CodexPermissionFullAccess: Story = {
  render: () => <CodexPermissionPopoverMock activeId="full-access" />,
}

export const GitBranchClean: Story = {
  render: () => <GitBranchPopoverMock current="main" />,
}

export const GitBranchDirtySearching: Story = {
  render: () => (
    <GitBranchPopoverMock
      current="main"
      dirty={{ files: 18, insertions: 426, deletions: 191 }}
      search="fix"
    />
  ),
}

export const GitBranchCreate: Story = {
  render: () => (
    <GitBranchPopoverMock current="main" search="feat/popover-mocks" showCreateBranch />
  ),
}

export const Worktrees: Story = {
  render: () => <WorktreePopoverMock />,
}

export const WorktreesActive: Story = {
  render: () => (
    <WorktreePopoverMock
      isInWorktree
      entries={[
        { branch: "feat/relay-multimobile", shortHead: "a1b2c3d", dirtyFiles: 2, isActive: true },
        { branch: "chore/upgrade-react", shortHead: "e4f5061" },
      ]}
    />
  ),
}

export const StatusBarDefault: Story = {
  render: () => (
    <div className="rounded-lg border border-border bg-card">
      <ChatStatusBarMock />
    </div>
  ),
}

export const StatusBarBranchActive: Story = {
  render: () => (
    <div className="rounded-lg border border-border bg-card">
      <ChatStatusBarMock activeTrigger="branch" />
    </div>
  ),
}

export const StatusBarPlanMode: Story = {
  render: () => (
    <div className="rounded-lg border border-border bg-card">
      <ChatStatusBarMock permission={{ id: "plan", label: "Plan Mode" }} activeTrigger="permission" />
    </div>
  ),
}

export const StatusBarCodexHarness: Story = {
  render: () => (
    <div className="rounded-lg border border-border bg-card">
      <ChatStatusBarMock harness="codex" />
    </div>
  ),
}

export const ModelEffortStrip: Story = {
  render: () => (
    <div className="rounded-lg border border-border bg-card p-3">
      <ModelEffortTriggerStrip />
    </div>
  ),
}
