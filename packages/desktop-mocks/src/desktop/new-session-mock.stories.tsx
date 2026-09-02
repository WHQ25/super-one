import type { Meta, StoryObj } from "@storybook/react-vite"
import { NewSessionMock } from "./new-session-mock"
import { HARNESS_SHOWCASE_IDS } from "./showcase-catalog"

const meta: Meta<typeof NewSessionMock> = {
  title: "Desktop Mocks/NewSessionMock",
  component: NewSessionMock,
  parameters: { layout: "centered" },
  args: {
    defaultHarness: "claude",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1280, height: 800 }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    defaultHarness: {
      control: { type: "inline-radio" },
      options: HARNESS_SHOWCASE_IDS,
    },
    harness: {
      control: { type: "inline-radio" },
      options: [undefined, ...HARNESS_SHOWCASE_IDS],
    },
    placeholder: { control: "text" },
  },
}

export default meta
type Story = StoryObj<typeof NewSessionMock>

export const Default: Story = {}

export const DefaultsToCodex: Story = {
  args: { defaultHarness: "codex" },
}

export const ControlledClaude: Story = {
  args: { harness: "claude" },
}

export const ControlledCodex: Story = {
  args: { harness: "codex" },
}

export const ControlledCursor: Story = {
  args: { harness: "cursor" },
}

export const ControlledOpenCode: Story = {
  args: { harness: "opencode" },
}

export const ControlledDeepSeek: Story = {
  args: { harness: "dsh" },
}

export const ControlledGrokAcp: Story = {
  args: { harness: "acp" },
}

export const CustomPlaceholder: Story = {
  args: {
    placeholder: "随便问点什么…",
  },
}
