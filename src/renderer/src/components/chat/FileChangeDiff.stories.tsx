import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Chat/FileChangeDiff',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const ADD_DIFF = [
  'export function clampBrandHue(hue: number): number {',
  '  if (Number.isNaN(hue)) return 0',
  '  return ((hue % 360) + 360) % 360',
  '}',
].join('\n')

const DELETE_DIFF = [
  'function legacySend(text: string) {',
  '  // pre-ownership-refactor implementation',
  '  globalRegistry.lock(this.sessionId)',
  '  this.transport.write(text)',
  '}',
].join('\n')

const MODIFY_UNIFIED = [
  '@@ -10,7 +10,9 @@',
  ' export class Session {',
  '   owner: Owner = { kind: "local" }',
  '+  subscribers = new Set<string>()',
  ' ',
  '-  send(text: string) {',
  '+  send(text: string, origin: Origin) {',
  '+    if (origin === "local" && this.isRemotelyControlled()) throw new SessionLockedError()',
  '     this.transport.send(text)',
  '   }',
  ' }',
].join('\n')

export const AddFile: Story = {
  args: {
    toolName: 'FileChange',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/shared/harness-brand.ts',
      kind: 'add',
      diff: ADD_DIFF,
    }),
    status: 'complete',
  },
}

export const DeleteFile: Story = {
  args: {
    toolName: 'FileChange',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/main/legacy-send.ts',
      kind: 'delete',
      diff: DELETE_DIFF,
    }),
    status: 'complete',
  },
}

export const ModifyFile: Story = {
  args: {
    toolName: 'FileChange',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/main/session/session.ts',
      kind: 'modify',
      diff: MODIFY_UNIFIED,
    }),
    status: 'complete',
  },
}
