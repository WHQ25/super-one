import type { Meta, StoryObj } from '@storybook/react-vite'
import { PortableToolRow } from './PortableToolRow'

const meta = {
  title: 'Tool UI/Mobile/File edit',
  component: PortableToolRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>],
} satisfies Meta<typeof PortableToolRow>
export default meta
type Story = StoryObj<typeof meta>

const editArgs = {
  toolName: 'Edit' as const,
  toolUseId: 'edit-1',
  input: JSON.stringify({ file_path: '/workspace/apps/mobile/src/config.ts' }),
  status: 'complete' as const,
  toolDiff: '-const previewEnabled = false\n+const previewEnabled = true',
  toolLineDelta: { added: 1, removed: 1 },
}

export const EditCollapsed: Story = {
  args: editArgs,
}

export const EditExpanded: Story = {
  args: { ...editArgs, hasDeferredDetails: true },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}

export const WriteCollapsed: Story = {
  args: {
    toolName: 'Write',
    toolUseId: 'write-1',
    input: JSON.stringify({ file_path: '/workspace/docs/catalog.md' }),
    status: 'complete',
    toolDiff: '+# Tool catalog\n+\n+Every row the phone can draw.',
    toolLineDelta: { added: 3, removed: 0 },
  },
}

export const WriteExpanded: Story = {
  args: {
    toolName: 'Write',
    toolUseId: 'write-1',
    input: JSON.stringify({ file_path: '/workspace/docs/catalog.md' }),
    status: 'complete',
    toolDiff: '+# Tool catalog\n+\n+Every row the phone can draw.',
    toolLineDelta: { added: 3, removed: 0 },
    hasDeferredDetails: true,
  },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}

export const FileChangeCollapsed: Story = {
  args: {
    toolName: 'FileChange',
    toolUseId: 'change-1',
    input: JSON.stringify({ file_path: '/workspace/packages/shared/src/remote-tool-input.ts', kind: 'update' }),
    status: 'complete',
    toolDiff: '@@ -12,3 +12,4 @@\n export function shouldKeepRemoteToolInput(toolName: string): boolean {\n-  return REMOTE_TOOL_INPUT_NAMES.has(toolName)\n+  return REMOTE_TOOL_INPUT_NAMES.has(toolName)\n+    || REMOTE_TOOL_INPUT_SUFFIXES.some((suffix) => toolName.endsWith(suffix))',
    toolLineDelta: { added: 2, removed: 1 },
  },
}

export const FileChangeExpanded: Story = {
  args: {
    toolName: 'FileChange',
    toolUseId: 'change-1',
    input: JSON.stringify({ file_path: '/workspace/packages/shared/src/remote-tool-input.ts', kind: 'update' }),
    status: 'complete',
    toolDiff: '@@ -12,3 +12,4 @@\n export function shouldKeepRemoteToolInput(toolName: string): boolean {\n-  return REMOTE_TOOL_INPUT_NAMES.has(toolName)\n+  return REMOTE_TOOL_INPUT_NAMES.has(toolName)\n+    || REMOTE_TOOL_INPUT_SUFFIXES.some((suffix) => toolName.endsWith(suffix))',
    toolLineDelta: { added: 2, removed: 1 },
    hasDeferredDetails: true,
  },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}
