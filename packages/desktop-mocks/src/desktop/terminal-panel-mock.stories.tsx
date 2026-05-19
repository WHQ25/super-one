import type { Meta, StoryObj } from "@storybook/react-vite"
import { DesktopShell } from "./desktop-shell"
import { TerminalPanelMock, type MockTerminalLine } from "./terminal-panel-mock"

const meta: Meta<typeof TerminalPanelMock> = {
  title: "Desktop Mocks/TerminalPanel",
  component: TerminalPanelMock,
  parameters: { layout: "fullscreen" },
  argTypes: {
    cursor: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof TerminalPanelMock>

export const Default: Story = {
  decorators: [
    (Story) => (
      <div style={{ height: 280 }} className="border-t border-border bg-card">
        <Story />
      </div>
    ),
  ],
}

const GIT_LINES: MockTerminalLine[] = [
  [
    { text: "➜  ", color: "green", bold: true },
    { text: "super-one ", color: "cyan" },
    { text: "git:(", color: "blue" },
    { text: "main", color: "red" },
    { text: ") ", color: "blue" },
    { text: "git status" },
  ],
  [{ text: "On branch main", color: "muted" }],
  [{ text: "Changes not staged for commit:", color: "muted" }],
  [{ text: "\tmodified:   ", color: "red" }, { text: "packages/desktop-mocks/src/desktop/terminal-panel-mock.tsx", color: "red" }],
  [{ text: "\tmodified:   ", color: "red" }, { text: "packages/desktop-mocks/src/desktop/desktop-shell.tsx", color: "red" }],
  "",
  [
    { text: "➜  ", color: "green", bold: true },
    { text: "super-one ", color: "cyan" },
    { text: "git:(", color: "blue" },
    { text: "main", color: "red" },
    { text: ") ", color: "blue" },
  ],
]

export const GitStatus: Story = {
  args: { lines: GIT_LINES },
  decorators: [
    (Story) => (
      <div style={{ height: 280 }} className="border-t border-border bg-card">
        <Story />
      </div>
    ),
  ],
}

export const InShell: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <div style={{ height: 760, display: "flex" }}>
      <DesktopShell
        headerTitle="Refactor sidebar layout"
        showTerminalToggle
        terminalOpen
        terminalHeight={260}
      >
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Chat content
        </div>
      </DesktopShell>
    </div>
  ),
}
