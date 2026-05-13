import type { Meta, StoryObj } from "@storybook/react-vite"
import { FilePreviewMock } from "./file-preview-mock"

const meta: Meta<typeof FilePreviewMock> = {
  title: "Desktop Mocks/FilePreviewMock",
  component: FilePreviewMock,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: 600, width: 960 }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof FilePreviewMock>

export const CodeTypeScript: Story = {
  args: {
    spec: {
      kind: "code",
      filePath: "packages/desktop-mocks/src/desktop/file-tree-mock.tsx",
      language: "tsx",
      code: `export function FileTreeMock({ rootName, nodes, selectedPath }: FileTreeMockProps) {
  const flat: FlatRow[] = []
  flatten(nodes, 0, flat)
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {rootName && (
        <div className="px-3 py-1.5">
          <span className="text-md font-medium text-sidebar-foreground/70">{rootName}</span>
        </div>
      )}
    </div>
  )
}`,
    },
  },
}

export const Markdown: Story = {
  args: {
    spec: {
      kind: "markdown",
      filePath: "README.md",
      content: `# SuperOne

SuperOne is an Electron meta desktop app, built around AI agents as the engine.

## Mock package

\`@superone/desktop-mocks\` ships the desktop UI in a form that's safe to render
outside Electron.

- Storybook
- The marketing site
- The Remotion video pipeline

> Same components, optionally driven by a \`frame\` prop.

\`\`\`bash
bun run dev:video         # Remotion studio
bun run storybook         # Storybook
\`\`\``,
    },
  },
}

export const Diff: Story = {
  args: {
    spec: {
      kind: "diff",
      filePath: "apps/desktop/src/main/session/session.ts",
      startLine: 312,
      oldText:
        "this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== id)",
      newText:
        "this.pendingPermissions = this.pendingPermissions.map((p) => (\n  p.id === id ? { ...p, status: 'denying' } : p\n))",
    },
  },
}

export const ImagePlaceholder: Story = {
  args: {
    spec: { kind: "image", filePath: "docs/marketing/hero.png", src: "", alt: "docs/marketing/hero.png" },
  },
}
