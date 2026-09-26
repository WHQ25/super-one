import type { Meta, StoryObj } from '@storybook/react-vite'
import type { BashEditDiff, ChatMessage } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

const fullDiff: BashEditDiff = {
  files: [{ filePath: '/project/src/main.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const ready = false', '+const ready = true'] }] }],
  moreFiles: 1,
  changedFiles: ['/project/src/main.ts', '/project/assets/logo.png'],
}
const compactDiff: BashEditDiff = {
  files: [], moreFiles: 2, changedFiles: fullDiff.changedFiles,
  summary: { files: 2, added: 1, removed: 1, approximate: true },
  fileChanges: [{ path: '/project/src/main.ts', added: 1, removed: 1 }, { path: '/project/assets/logo.png', added: 0, removed: 0 }],
}

function MobileBashEdit({ diff, scheme }: { diff: BashEditDiff; scheme: 'light' | 'dark' }) {
  const message: ChatMessage = {
    id: 'bash-edit', role: 'assistant', providerId: 'claude', status: 'complete', createdAt: '2026-09-26T00:00:00Z',
    content: [
      { type: 'bash', toolName: 'Bash', toolUseId: 'bash', input: '{"command":"bun run build"}', status: 'complete' },
      { type: 'bash_result', toolUseId: 'bash', summary: '', bashEditDiff: diff },
    ],
  }
  return <div className="w-[390px] p-3"><PortableMessage message={message} scheme={scheme} pendingPermission={null} sessionStreaming={false} /></div>
}

const meta = {
  title: 'Chat/Portable Bash edits',
  component: MobileBashEdit,
  args: { diff: compactDiff, scheme: 'dark' },
} satisfies Meta<typeof MobileBashEdit>

export default meta
type Story = StoryObj<typeof meta>

export const Compact: Story = { name: 'Collapsed totals and file names' }
export const ExpandedDiff: Story = { args: { diff: fullDiff, scheme: 'light' }, name: 'Loaded file diff' }
