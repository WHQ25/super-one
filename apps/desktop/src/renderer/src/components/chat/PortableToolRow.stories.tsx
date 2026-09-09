import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'

const meta = {
  title: 'Tool UI/Mobile/Command output',
  component: PortableToolRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  args: { toolName: 'Bash', toolUseId: 'mobile-command', input: '{"command":"bun run build"}', status: 'streaming' },
} satisfies Meta<typeof PortableToolRow>
export default meta
type Story = StoryObj<typeof meta>

export const Waiting: Story = {}
export const PartialOutput: Story = { args: { result: 'Building shared packages…\nBuilding mobile chat…' } }
export const Complete: Story = { args: { result: 'Build complete\nExit code 0', status: 'complete' } }
export const Failed: Story = { args: { result: 'Build failed\nExit code 1', status: 'complete', isError: true } }
export const LongOutput: Story = { args: { result: Array.from({ length: 30 }, (_, i) => `Building package ${i + 1} with a long output line to check narrow mobile layouts`).join('\n') } }
export const ReceiveOutput: Story = {
  render: function Preview(args) {
    const [step, setStep] = useState(0)
    return <>
      <button onClick={() => setStep((value) => (value + 1) % 3)}>Next output chunk</button>
      <PortableToolRow {...args} status={step === 2 ? 'complete' : 'streaming'}
        result={step === 0 ? undefined : step === 1 ? 'First output chunk' : 'First output chunk\nBuild complete'} />
    </>
  },
}

export const ExpandedCommandOnce: Story = {
  args: {
    input: JSON.stringify({ command: '/bin/zsh -lc "git status --short"' }),
    result: ' M apps/desktop/src/main/remote-control-service.ts',
    status: 'complete',
  },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}

export const CodexStreamingCommand: Story = {
  render: function Preview() {
    const [step, setStep] = useState(0)
    return <>
      <button onClick={() => setStep((value) => (value + 1) % 3)}>Next Codex output</button>
      <PortableMessage scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming
        message={{
          id: 'codex-command-turn', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'codex', content: [],
          metadata: { codex: { threadId: 'preview', usage: null, items: [{
            id: 'codex-command', type: 'command_execution', command: 'bun run build',
            aggregatedOutput: step === 0 ? '' : step === 1 ? 'Building…' : 'Build complete',
            status: step === 2 ? 'completed' : 'in_progress',
            ...(step === 2 ? { exitCode: 0 } : {}),
          }] } },
        }} />
    </>
  },
}

export const LegacyHistoryCommand: Story = {
  args: {
    input: JSON.stringify({ command: 'bun run build' }),
    result: '\x1b[32m$\x1b[0m bun run build\nBuild complete',
    status: 'complete',
  },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click()
  },
}
