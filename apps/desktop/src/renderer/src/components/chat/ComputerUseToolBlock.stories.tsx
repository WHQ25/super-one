import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'
import type { ComputerOp } from './computer-tool-display'

function StoryShell({
  children,
  width = 720,
}: {
  children: ReactNode
  width?: number
}) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function tool(
  op: ComputerOp,
  options: {
    description: string
    input?: Record<string, unknown>
    result?: string
    status?: 'streaming' | 'complete'
    elapsedSeconds?: number
    isError?: boolean
  },
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__computer_${op}`}
      input={JSON.stringify({
        description: options.description,
        ...(options.input ?? {}),
      })}
      result={options.result}
      status={options.status ?? 'complete'}
      elapsedSeconds={options.elapsedSeconds}
      isError={options.isError}
    />
  )
}

const meta: Meta = {
  title: 'SuperOne/MCP Tools/Computer',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <StoryShell>
        <Story />
      </StoryShell>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  render: () => (
    <StoryShell width={760}>
      {tool('apps', {
        description: 'Check available desktop apps',
        result: JSON.stringify({
          granted: [{ app: 'TextEdit' }],
          running: [{ app: 'TextEdit' }, { app: 'Finder' }, { app: 'Preview' }],
          roots: [{ rootId: '@r1' }, { rootId: '@r2' }],
          frontmost: 'TextEdit',
        }),
      })}
      {tool('apps', {
        description: 'Open Preview',
        input: { action: 'launch', app: 'Preview' },
        result: JSON.stringify({ running: [], roots: [] }),
      })}
      {tool('snapshot', {
        description: 'Inspect the Meeting notes window',
        input: { root: '@r1', mode: 'fused', capture: 'window' },
        result: JSON.stringify({
          stateId: '@s1',
          root: {
            app: 'TextEdit',
            bundleId: 'com.apple.TextEdit',
            title: 'Meeting notes',
          },
          image: {
            path: '/tmp/superone-computer-use/observe.png',
            width: 1280,
            height: 800,
          },
          outline: { ref: '@e1', role: 'window', name: 'Meeting notes' },
        }),
      })}
      {tool('zoom', {
        description: 'Inspect the document controls more closely',
        input: { stateId: '@s1', region: [120, 80, 620, 420] },
        result: JSON.stringify({
          stateId: '@s1',
          root: { app: 'TextEdit', bundleId: 'com.apple.TextEdit' },
          image: { path: '/tmp/superone-computer-use/zoom.png' },
        }),
      })}
      {tool('query', {
        description: 'Find the Save button',
        input: { stateId: '@s1', op: 'search', text: 'Save' },
        result: JSON.stringify({
          matches: [{ ref: '@e4', role: 'button', name: 'Save' }],
        }),
      })}
      {tool('act', {
        description: 'Save the meeting notes',
        input: { stateId: '@s1', actions: [{ type: 'click', ref: '@e4' }] },
        result: JSON.stringify({
          outcome: 'worked',
          successorStateId: '@s2',
          successorRoot: {
            app: 'TextEdit',
            bundleId: 'com.apple.TextEdit',
            title: 'Meeting notes',
          },
          successorImage: { path: '/tmp/superone-computer-use/after.png' },
          evidence: [{ description: 'button state changed' }],
        }),
      })}
      {tool('wait_for', {
        description: 'Wait for the save confirmation',
        input: {
          stateId: '@s2',
          condition: { kind: 'exists', ref: '@e7' },
          timeoutMs: 5000,
        },
        result: JSON.stringify({ status: 'verified', successorStateId: '@s3' }),
      })}
    </StoryShell>
  ),
}

export const Streaming: Story = {
  render: () => (
    <StoryShell>
      {tool('snapshot', {
        description: 'Inspect the active window',
        input: { root: '@r1' },
        status: 'streaming',
        elapsedSeconds: 2,
      })}
      {tool('act', {
        description: 'Fill in the account name',
        input: {
          stateId: '@s1',
          actions: [{ type: 'typeText', ref: '@e2', text: 'secret' }],
        },
        status: 'streaming',
        elapsedSeconds: 3,
      })}
      {tool('wait_for', {
        description: 'Wait for the next screen',
        input: { stateId: '@s1', condition: { kind: 'exists', ref: '@e5' } },
        status: 'streaming',
        elapsedSeconds: 5,
      })}
    </StoryShell>
  ),
}

export const OutcomesAndErrors: Story = {
  render: () => (
    <StoryShell>
      {tool('act', {
        description: 'Open the export dialog',
        input: { stateId: '@s1', actions: [{ type: 'click', ref: '@e9' }] },
        result: JSON.stringify({
          outcome: 'didnt',
          successorStateId: '@s2',
          evidence: [],
        }),
      })}
      {tool('act', {
        description: 'Scroll to the document footer',
        input: { stateId: '@s1', actions: [{ type: 'scroll', dy: 500 }] },
        result: JSON.stringify({
          outcome: 'unknown',
          successorStateId: '@s2',
          evidence: [],
        }),
      })}
      {tool('wait_for', {
        description: 'Wait for the dialog to close',
        input: { stateId: '@s2', condition: { kind: 'notExists', ref: '@e3' } },
        result: JSON.stringify({ status: 'failed', successorStateId: '@s4' }),
      })}
      {tool('snapshot', {
        description: 'Refresh the changed target window',
        input: { root: '@r3' },
        result: JSON.stringify({
          error: 'STALE_STATE',
          message: 'The target window changed',
        }),
      })}
      {tool('act', {
        description: 'Confirm the destructive action',
        input: { stateId: '@s1', actions: [{ type: 'click', ref: '@e1' }] },
        result: '[denied] User denied permission',
      })}
    </StoryShell>
  ),
}

export const NarrowChat: Story = {
  render: () => (
    <StoryShell width={360}>
      {tool('snapshot', {
        description: 'Inspect the current document before editing',
        input: { root: '@r123', mode: 'visual', capture: 'display' },
        result: JSON.stringify({
          stateId: '@s-long-state-id',
          root: {
            app: 'A Very Long Application Name',
            title: 'A document title that should truncate cleanly',
          },
          image: { path: '/tmp/superone-computer-use/narrow.png' },
        }),
      })}
      {tool('act', {
        description: 'Submit the document with the keyboard shortcut',
        input: {
          stateId: '@s1',
          actions: [
            { type: 'click', ref: '@e123456' },
            { type: 'keypress', keys: ['COMMAND', 'SHIFT', 'ENTER'] },
          ],
        },
        result: JSON.stringify({
          outcome: 'worked',
          successorStateId: '@s2',
          evidence: [],
        }),
      })}
    </StoryShell>
  ),
}
