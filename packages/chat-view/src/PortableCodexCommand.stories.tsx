import type { Meta, StoryObj } from '@storybook/react-vite'
import { PortableCodexCommand } from './PortableCodexCommand'

const meta = {
  title: 'Chat/Codex/Mobile Command',
  component: PortableCodexCommand,
  parameters: { layout: 'padded' },
  globals: { harness: 'codex' },
  decorators: [(Story) => <div className="w-full max-w-[390px]"><Story /></div>],
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
