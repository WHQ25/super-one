import type { Meta, StoryObj } from "@storybook/react-vite"
import { FileTreeMock, SAMPLE_FILE_TREE } from "./file-tree-mock"

const meta: Meta<typeof FileTreeMock> = {
  title: "Desktop Mocks/FileTreeMock",
  component: FileTreeMock,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: 720, width: 360 }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof FileTreeMock>

export const Default: Story = {
  args: {
    rootName: "super-one",
    nodes: SAMPLE_FILE_TREE,
    selectedPath: "packages/desktop-mocks/src/desktop/file-tree-mock.tsx",
  },
}

export const Empty: Story = {
  args: { rootName: "empty-project", nodes: [] },
}

export const SmallChange: Story = {
  args: {
    rootName: "super-one",
    nodes: [
      {
        name: "apps",
        path: "apps",
        isDirectory: true,
        isExpanded: true,
        children: [
          {
            name: "desktop",
            path: "apps/desktop",
            isDirectory: true,
            isExpanded: true,
            children: [
              {
                name: "package.json",
                path: "apps/desktop/package.json",
                isDirectory: false,
                gitWorktree: "M",
              },
              {
                name: "tsconfig.json",
                path: "apps/desktop/tsconfig.json",
                isDirectory: false,
              },
            ],
          },
        ],
      },
      {
        name: "README.md",
        path: "README.md",
        isDirectory: false,
        gitWorktree: "?",
      },
      {
        name: ".env",
        path: ".env",
        isDirectory: false,
        gitWorktree: "!",
      },
    ],
    selectedPath: "apps/desktop/package.json",
  },
}
