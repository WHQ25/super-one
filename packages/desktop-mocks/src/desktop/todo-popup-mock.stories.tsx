import type { Meta, StoryObj } from "@storybook/react-vite"
import { TodoPopupMock, type TodoPopupItem } from "./todo-popup-mock"

const meta: Meta<typeof TodoPopupMock> = {
  title: "Desktop Mocks/TodoPopupMock",
  component: TodoPopupMock,
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

type Story = StoryObj<typeof TodoPopupMock>

const refactorItems: TodoPopupItem[] = [
  { id: "1", text: "Read session.ts to understand current state", status: "completed" },
  { id: "2", text: "Identify pendingPermissions invariant bug", status: "completed" },
  { id: "3", text: "Write regression test that fails on current code", status: "in_progress" },
  { id: "4", text: "Patch the deny() handler to keep pending entry", status: "pending" },
  { id: "5", text: "Re-run tests, verify all green", status: "pending" },
]

export const Expanded: Story = {
  args: {
    items: refactorItems,
    expanded: true,
  },
}

export const Collapsed: Story = {
  args: {
    items: refactorItems,
    expanded: false,
  },
}

export const CollapsedInProgress: Story = {
  args: {
    items: refactorItems,
    expanded: false,
  },
}

export const AllCompleted: Story = {
  args: {
    items: refactorItems.map((item) => ({ ...item, status: "completed" as const })),
    expanded: true,
  },
}

export const SingleInProgress: Story = {
  args: {
    items: [
      { id: "1", text: "Spin up the dev server and capture a baseline build time", status: "in_progress" },
    ],
    expanded: true,
  },
}

export const WithoutKbdHint: Story = {
  args: {
    items: refactorItems,
    expanded: true,
    showKbdHint: false,
  },
}

export const FrameDriven: Story = {
  args: {
    items: refactorItems,
    frame: 90,
    fps: 30,
    expandAtSec: 2,
  },
}
