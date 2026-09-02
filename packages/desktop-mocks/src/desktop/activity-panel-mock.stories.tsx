import type { Meta, StoryObj } from "@storybook/react-vite"
import { ActivityPanelMock } from "./activity-panel-mock"

const meta: Meta<typeof ActivityPanelMock> = {
  title: "Desktop Mocks/ActivityPanel",
  component: ActivityPanelMock,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="h-[700px] w-[1120px]">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    activeTabId: {
      control: "select",
      options: ["file", "mini-app", "browser", "terminal", "trajectory", "device", "side-chat"],
    },
    maximized: { control: "boolean" },
    forceCloseTabId: {
      control: "select",
      options: [undefined, "file", "mini-app", "browser", "terminal", "trajectory", "device", "side-chat"],
    },
    sideChatCloseConfirmationOpen: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof ActivityPanelMock>

export const SideChatActive: Story = {}

export const CloseHoverVisual: Story = {
  args: {
    activeTabId: "browser",
    forceCloseTabId: "trajectory",
  },
}

export const Maximized: Story = {
  args: {
    activeTabId: "mini-app",
    maximized: true,
  },
}

export const SideChatCloseConfirmation: Story = {
  args: {
    sideChatCloseConfirmationOpen: true,
  },
}
