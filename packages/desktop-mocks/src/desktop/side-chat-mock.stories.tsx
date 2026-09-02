import type { Meta, StoryObj } from "@storybook/react-vite"
import { SideChatMock } from "./side-chat-mock"
import { HARNESS_SHOWCASE_IDS } from "./showcase-catalog"

const meta: Meta<typeof SideChatMock> = {
  title: "Desktop Mocks/SideChat",
  component: SideChatMock,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="h-[680px] w-[440px] overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    parentTitle: { control: "text" },
    composerPlaceholder: { control: "text" },
    harness: { control: "select", options: HARNESS_SHOWCASE_IDS },
    contextPct: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    closeConfirmationOpen: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof SideChatMock>

export const Initial: Story = {}

export const CodexContext: Story = {
  args: {
    harness: "codex",
    parentTitle: "Trace the relay reconnect regression",
    composerPlaceholder: "Ask GPT5.6 Sol a focused follow-up",
    contextPct: 0.62,
  },
}

export const CloseConfirmation: Story = {
  args: { closeConfirmationOpen: true },
}
