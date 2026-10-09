import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { PortableCodexCommand } from './PortableCodexCommand'
import { installFakeNativeHost } from './fixtures/native-host'

function CommandHost({ children, mode }: { children: ReactNode; mode?: 'loading' | 'retry' }) {
  useEffect(() => {
    let attempts = 0
    return installFakeNativeHost((request, reply) => {
      if (request.action !== 'subscribeDetail') { reply({ result: true }); return }
      if (mode === 'loading') return
      if (mode === 'retry' && attempts++ === 0) { reply({ error: 'Unable to load command output' }); return }
      reply({ result: { subscriptionId: request.payload?.subscriptionId, revision: 0, offset: 0,
        text: JSON.stringify({ input: JSON.stringify({ command: 'head -n 20 src/a.ts src/b.ts' }), result: 'Shared output for both files.' }) } })
    })
  }, [mode])
  return children
}

const meta = {
  title: 'Chat/Codex/Mobile Command',
  component: PortableCodexCommand,
  parameters: { layout: 'padded' },
  globals: { harness: 'codex' },
  decorators: [(Story, context) => <CommandHost mode={context.parameters.detailMode}><div className="w-full max-w-[390px]"><Story /></div></CommandHost>],
  args: {
    item: { id: 'command', type: 'command_execution', command: 'rg missing README.md',
      aggregatedOutput: '', status: 'completed', exitCode: 0 },
    isStreaming: false,
  },
} satisfies Meta<typeof PortableCodexCommand>

export default meta
type Story = StoryObj<typeof meta>

export const Complete: Story = {}
export const Running: Story = {
  args: { isStreaming: true, item: { ...meta.args.item, status: 'in_progress', exitCode: undefined } },
}
export const NonZeroExit: Story = {
  name: 'Non-zero exit · normal tool outcome',
  args: { item: { ...meta.args.item, status: 'failed', exitCode: 1 } },
}
export const ToolFailure: Story = {
  args: { item: { ...meta.args.item, status: 'failed', exitCode: undefined, aggregatedOutput: 'Unable to start process' } },
}
export const DeferredNonZeroExit: Story = {
  name: 'Deferred non-zero exit · collapsed',
  args: { item: { ...meta.args.item, status: 'failed', exitCode: 1, remoteDetail: 'story-command' } },
}
export const ExpandedNonZeroExit: Story = {
  args: NonZeroExit.args,
  play: async ({ canvasElement }) => { canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click() },
}
export const NarrowLongOutput: Story = {
  args: { item: { ...meta.args.item, command: 'bun run typecheck --project apps/mobile/tsconfig.json',
    aggregatedOutput: 'src/runtime.ts: The selected session is unavailable.\n'.repeat(20), status: 'failed', exitCode: 2 } },
  decorators: [(Story) => <div className="w-[320px] max-w-full"><Story /></div>],
  play: ExpandedNonZeroExit.play,
}

export const MultiRead: Story = {
  args: { item: { ...meta.args.item, cwd: '/repo', command: 'head -n 20 src/a.ts src/b.ts',
    commandActions: [{ type: 'read', path: '/repo/src/a.ts' }], aggregatedOutput: 'Shared output for both files.' } },
  play: ExpandedNonZeroExit.play,
}
export const MultiReadDeferred: Story = {
  args: { item: { ...MultiRead.args!.item!, remoteDetail: 'story-multi-read', aggregatedOutput: '' } },
  play: MultiRead.play,
}
export const MultiReadLoading: Story = { ...MultiReadDeferred, parameters: { detailMode: 'loading' } }
export const MultiReadRetry: Story = { ...MultiReadDeferred, parameters: { detailMode: 'retry' } }
export const MultiReadNarrowChinese: Story = {
  ...MultiRead,
  globals: { locale: 'zh', theme: 'dark' },
  decorators: [(Story) => <div className="w-[320px] max-w-full"><Story /></div>],
}
export const MultiReadLight: Story = { ...MultiRead, globals: { theme: 'light' } }
export const MultiReadLongPaths: Story = {
  ...MultiRead,
  args: { item: { ...meta.args.item, command: 'compound read commands', commandActions: Array.from({ length: 36 }, (_, index) => ({
    type: 'read', path: `/repo/deeply/nested/directory-${index}/very-long-file-name-for-mobile-preview-${index}.tsx`,
  })) } },
  decorators: [(Story) => <div className="w-[320px] max-w-full"><Story /></div>],
}
export const MixedExploration: Story = {
  args: { item: { ...meta.args.item, command: 'cat src/a.ts && rg TODO src && ls tests', commandActions: [
    { type: 'read', path: '/repo/src/a.ts' }, { type: 'search', query: 'TODO', path: '/repo/src' }, { type: 'listFiles', path: '/repo/tests' },
  ] } },
  play: MultiRead.play,
}
