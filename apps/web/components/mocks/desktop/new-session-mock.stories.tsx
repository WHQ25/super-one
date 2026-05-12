import type { Meta, StoryObj } from "@storybook/react-vite"
import { NewSessionMock } from "./new-session-mock"

const meta: Meta<typeof NewSessionMock> = {
  title: "Web/Mocks/Desktop/NewSessionMock",
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
      options: ["claude", "codex"],
    },
    harness: {
      control: { type: "inline-radio" },
      options: [undefined, "claude", "codex"],
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

export const CustomPoweredBy: Story = {
  args: {
    poweredByClaude: "由 Anthropic 驱动",
    poweredByCodex: "由 OpenAI 驱动",
    placeholder: "随便问点什么…",
  },
}
