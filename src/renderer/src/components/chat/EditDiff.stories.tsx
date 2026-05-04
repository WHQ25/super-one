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
  title: 'Chat/EditDiff',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const SMALL_OLD = [
  'function greet(name: string) {',
  '  return `hello, ${name}`',
  '}',
].join('\n')

const SMALL_NEW = [
  'function greet(name: string, exclaim = false) {',
  '  return exclaim ? `hello, ${name}!` : `hello, ${name}`',
  '}',
].join('\n')

const MULTI_OLD = [
  'export class Session {',
  '  owner: Owner = { kind: "local" }',
  '',
  '  send(text: string) {',
  '    this.transport.send(text)',
  '  }',
  '}',
].join('\n')

const MULTI_NEW = [
  'export class Session {',
  '  owner: Owner = { kind: "local" }',
  '  subscribers = new Set<string>()',
  '',
  '  send(text: string, origin: Origin) {',
  '    if (origin === "local" && this.isRemotelyControlled()) {',
  '      throw new SessionLockedError()',
  '    }',
  '    this.transport.send(text)',
  '  }',
  '',
  '  isRemotelyControlled() {',
  '    return this.owner.kind === "remote" || this.subscribers.size > 0',
  '  }',
  '}',
].join('\n')

const NB_OLD = ['x = 1', 'y = 2', 'print(x + y)'].join('\n')
const NB_NEW = ['x = 10', 'y = 20', 'print(f"sum is {x + y}")'].join('\n')

export const SmallEdit: Story = {
  args: {
    toolName: 'Edit',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/renderer/src/lib/greet.ts',
      old_string: SMALL_OLD,
      new_string: SMALL_NEW,
    }),
    status: 'complete',
  },
}

export const MultiHunkEdit: Story = {
  args: {
    toolName: 'Edit',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/main/session/session.ts',
      old_string: MULTI_OLD,
      new_string: MULTI_NEW,
    }),
    status: 'complete',
  },
}

export const NotebookEditCell: Story = {
  args: {
    toolName: 'NotebookEdit',
    input: JSON.stringify({
      notebook_path: '/Users/me/notebooks/analysis.ipynb',
      old_source: NB_OLD,
      new_source: NB_NEW,
    }),
    status: 'complete',
  },
}

export const EditError: Story = {
  args: {
    toolName: 'Edit',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/renderer/src/missing.ts',
      old_string: 'foo',
      new_string: 'bar',
    }),
    status: 'complete',
    result: 'Error: File not found',
    isError: true,
  },
}
