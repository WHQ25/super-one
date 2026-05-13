import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlanApprovalMock } from "./plan-approval-mock"

const PLAN = `## Refactor sidebar expansion state

The sidebar currently uses a boolean to track whether the active project's rows are expanded, so switching projects collapses everything else.

### Approach

1. Replace the boolean expansion state in \`AppSidebar.tsx\` with a \`Set<string>\` keyed by \`folderPath\`.
2. Re-wire the chevron's \`onClick\` to toggle only that path — keep row body click for project selection.
3. Add a regression test in \`AppSidebar.test.tsx\` for the new \`Cmd+Shift+[\` shortcut.

### Notes

- No persistence yet — verify in-memory behavior first.
- Scope is limited to \`AppSidebar.tsx\` plus the new test file.`

const meta: Meta<typeof PlanApprovalMock> = {
  title: "Desktop Mocks/PlanApprovalMock",
  component: PlanApprovalMock,
  parameters: { layout: "padded" },
  args: {
    fileName: "refactor-sidebar.plan.md",
    planContent: PLAN,
    allowedPrompts: [
      { tool: "Edit", prompt: "AppSidebar.tsx" },
      { tool: "Write", prompt: "AppSidebar.test.tsx" },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1024, height: 720, display: "flex" }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof PlanApprovalMock>

export const Default: Story = {}

export const SwitchToAcceptEdits: Story = {
  args: { switchAfterApproval: true, fastModeTarget: "acceptEdits" },
}

export const SwitchToAuto: Story = {
  args: { switchAfterApproval: true, fastModeTarget: "auto" },
}

export const FocusOnReject: Story = {
  args: { focusedAction: "reject" },
}
