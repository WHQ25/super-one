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

const richItems: TodoPopupItem[] = [
  {
    id: "1",
    text: "Audit relay frame encoder",
    status: "completed",
    description: "Confirmed every desktop→mobile frame carries mobileDeviceId; no targeting regressions.",
  },
  {
    id: "2",
    text: "Refactor ownership into Session class",
    status: "in_progress",
    description: "Moving claim/release/subscribe off RemoteControlService onto Session so lock checks live with the data.",
    owner: "session-refactor agent",
  },
  {
    id: "3",
    text: "Wire device-disconnect cleanup",
    status: "pending",
    description: "handleDeviceDisconnected walks forEachSession and releases + unsubscribes the dropped deviceId.",
    blockedBy: ["2"],
  },
  {
    id: "4",
    text: "Add multi-mobile integration test",
    status: "pending",
    blockedBy: ["2", "3"],
  },
]

export const WithDescriptionsAndOwners: Story = {
  args: {
    items: richItems,
    expanded: true,
  },
}

export const DetailRowExpanded: Story = {
  args: {
    items: richItems,
    expanded: true,
    openRowIds: ["1"],
  },
}
