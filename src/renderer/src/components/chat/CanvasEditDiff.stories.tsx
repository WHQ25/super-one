import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { CanvasEditDiff } from './CanvasEditDiff'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof CanvasEditDiff> = {
  title: 'Chat/CanvasEditDiff',
  component: CanvasEditDiff,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof CanvasEditDiff>

const OLD_CODE = [
  'export class Session {',
  '  owner: Owner = { kind: "local" }',
  '',
  '  send(text: string) {',
  '    this.transport.send(text)',
  '  }',
  '}',
].join('\n')

const NEW_PARTIAL = [
  'export class Session {',
  '  owner: Owner = { kind: "local" }',
  '  subscribers = new Set<string>()',
  '',
  '  send(text: string, origin: Origin) {',
  '    if (origin === "local" && this.isRemotelyControlled())',
].join('\n')

const NEW_COMPLETE = [
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
  '}',
].join('\n')

export const StreamingPartial: Story = {
  args: {
    params: {
      file_path: '/Users/me/projects/super-one/src/main/session/session.ts',
      old_string: OLD_CODE,
      new_string: NEW_PARTIAL,
    },
  },
}

export const StreamingComplete: Story = {
  args: {
    params: {
      file_path: '/Users/me/projects/super-one/src/main/session/session.ts',
      old_string: OLD_CODE,
      new_string: NEW_COMPLETE,
    },
  },
}

export const StreamingFromEmpty: Story = {
  args: {
    params: {
      file_path: '/Users/me/projects/super-one/src/main/session/session.ts',
      old_string: OLD_CODE,
      new_string: 'export class Sess',
    },
  },
}
