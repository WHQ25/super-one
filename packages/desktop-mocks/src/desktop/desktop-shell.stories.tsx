import type { Meta, StoryObj } from "@storybook/react-vite"
import { DesktopSidebar, type MockProject } from "./desktop-shell"
import { FileTreeMock, SAMPLE_FILE_TREE } from "./file-tree-mock"

const COLLAPSED_PROJECTS: MockProject[] = [
  { name: "super-one", active: true },
  { name: "marketing-site" },
  { name: "experiments" },
  { name: "relay" },
]

const MISSING_PROJECTS: MockProject[] = [
  { name: "old-prototype", missing: true },
  { name: "archived-spike", missing: true },
]

const meta: Meta<typeof DesktopSidebar> = {
  title: "Desktop Mocks/DesktopSidebar",
  component: DesktopSidebar,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: 760, display: "flex" }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    sidebarTab: { control: "inline-radio", options: ["sessions", "files"] },
    appsExpanded: { control: "boolean" },
    remoteOnline: { control: "boolean" },
    showTrafficLights: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof DesktopSidebar>

export const Default: Story = {}

export const AppsExpanded: Story = {
  args: { appsExpanded: true },
}

export const NoPinnedNoApps: Story = {
  args: { pinnedSessions: [], apps: [] },
}

export const EmptyProjects: Story = {
  args: { projects: [], pinnedSessions: [], drafts: [] },
}

export const CollapsedProjects: Story = {
  args: { projects: COLLAPSED_PROJECTS, pinnedSessions: [] },
}

export const MissingProjectsOnly: Story = {
  args: { projects: MISSING_PROJECTS, pinnedSessions: [], apps: [] },
}

export const RemoteOffline: Story = {
  args: { remoteOnline: false },
}

export const RemoteHost: Story = {
  args: { hostLabel: "Build Mac mini" },
}

export const FilesTab: Story = {
  args: {
    sidebarTab: "files",
    fileTree: (
      <FileTreeMock
        rootName="super-one"
        nodes={SAMPLE_FILE_TREE}
        selectedPath="packages/desktop-mocks/src/desktop/desktop-shell.tsx"
      />
    ),
  },
}
