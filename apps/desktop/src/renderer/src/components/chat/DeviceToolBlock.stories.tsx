import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { DeviceToolBlock } from './DeviceToolBlock'
import { ToolBlock } from './ToolBlock'
import type { DeviceOp } from './device-tool-display'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function tool(
  op: DeviceOp,
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
      toolName={`mcp__superone__device_${op}`}
      input={JSON.stringify({ description: options.description, ...(options.input ?? {}) })}
      result={options.result}
      status={options.status ?? 'complete'}
      elapsedSeconds={options.elapsedSeconds}
      isError={options.isError}
    />
  )
}

// Captured from a real iPhone 17 Pro Max on iOS 26.5, not invented.
const SNAPSHOT = JSON.stringify({
  stateId: 's2',
  device: 'iPhone 17 Pro Max',
  orientation: 'portrait',
  screen: { width: 1320, height: 2868 },
  settled: true,
  tree: '@e0 application "Safari"\n  @e1 button "Tabs" #TabOverview\n  @e2 textField "Address" #URL',
})

const SNAPSHOT_LANDSCAPE = JSON.stringify({
  stateId: 's7',
  device: 'iPhone 17 Pro Max',
  orientation: 'landscape-left',
  screen: { width: 1320, height: 2868 },
  settled: true,
  tree: '@e0 application "Safari"',
})

const FUSED = JSON.stringify({
  stateId: 's3',
  device: 'iPhone 17 Pro Max',
  orientation: 'portrait',
  screen: { width: 1320, height: 2868 },
  settled: false,
  truncated: true,
  image: { path: '/tmp/super-one-ios-simulator-captures/shot.png', width: 1320, height: 2868 },
  tree: '@e0 application "Safari"',
})

const ACT_WORKED = JSON.stringify({
  outcome: 'worked',
  reason: 'the screen changed',
  stateId: 's4',
  settled: true,
  orientation: 'portrait',
  tree: '@e0 application "Settings"',
})

const ACT_DIDNT = JSON.stringify({
  outcome: 'didnt',
  reason: 'the expected condition did not hold afterwards',
  expect: 'Wi-Fi exists',
  expectMet: false,
  stateId: 's5',
  settled: true,
  orientation: 'portrait',
  tree: '@e0 application "Settings"',
})

const ACT_UNKNOWN = JSON.stringify({
  outcome: 'unknown',
  reason: 'the input was delivered but the screen looks unchanged — pass expect to say what success looks like, rather than repeating the action',
  stateId: 's6',
  settled: true,
  orientation: 'portrait',
  tree: '@e0 application "Safari"',
})

const QUERY_HITS = JSON.stringify({
  stateId: 's2',
  matches: 3,
  results: ['@e4 button "Settings" #Settings', '@e9 cell "General"', '@e12 staticText "Settings"'],
})

const WAIT_VERIFIED = JSON.stringify({
  status: 'verified', condition: 'General exists', stateId: 's8', waitedMs: 620,
})

const WAIT_PREEXISTING = JSON.stringify({
  status: 'preexisting', condition: 'Safari exists', stateId: 's9', waitedMs: 0,
})

const WAIT_TIMEOUT = JSON.stringify({
  status: 'timeout',
  condition: 'Wi-Fi exists',
  stateId: 's10',
  waitedMs: 8000,
  hint: 'The condition never held. Take a device_snapshot to see what is actually on screen.',
})

const meta: Meta = {
  title: 'SuperOne/MCP Tools/Device',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const Snapshot: Story = {
  render: () => (
    <>
      {tool('snapshot', { description: 'Look at the Safari screen', result: SNAPSHOT })}
      {tool('snapshot', {
        description: 'Check the screen after rotating',
        result: SNAPSHOT_LANDSCAPE,
      })}
      {tool('snapshot', {
        description: 'Capture the page with a picture',
        input: { mode: 'fused' },
        result: FUSED,
      })}
    </>
  ),
}

export const Actions: Story = {
  render: () => (
    <>
      {tool('act', {
        description: 'Open the Settings app',
        input: { stateId: 's2', actions: [{ type: 'tap', ref: '@e4' }] },
        result: ACT_WORKED,
      })}
      {tool('act', {
        description: 'Scroll down the settings list',
        input: { stateId: 's4', actions: [{ type: 'swipe', ref: '@e0', direction: 'up' }] },
        result: ACT_WORKED,
      })}
      {tool('act', {
        description: 'Type the password into the field',
        input: { stateId: 's4', actions: [{ type: 'type', text: 'hunter2' }] },
        result: ACT_WORKED,
      })}
      {tool('act', {
        description: 'Turn the device on its side',
        input: { stateId: 's4', actions: [{ type: 'rotate', orientation: 'landscape-left' }] },
        result: ACT_WORKED,
      })}
      {tool('act', {
        description: 'Raise the on-screen keyboard',
        input: { stateId: 's4', actions: [{ type: 'keyboard', connected: false }] },
        result: ACT_WORKED,
      })}
      {tool('act', {
        description: 'Focus the field and enter the search term',
        input: {
          stateId: 's4',
          actions: [{ type: 'press', ref: '@e2' }, { type: 'type', text: 'weather' }],
        },
        result: ACT_WORKED,
      })}
    </>
  ),
}

/** The two results that look like success to a careless reader but are not. */
export const OutcomesThatNeedAttention: Story = {
  render: () => (
    <>
      {tool('act', {
        description: 'Open the Wi-Fi settings',
        input: {
          stateId: 's4',
          actions: [{ type: 'tap', ref: '@e9' }],
          expect: { kind: 'exists', label: 'Wi-Fi' },
        },
        result: ACT_DIDNT,
      })}
      {tool('act', {
        description: 'Toggle the switch',
        input: { stateId: 's4', actions: [{ type: 'tap', ref: '@e11' }] },
        result: ACT_UNKNOWN,
      })}
      {tool('wait_for', {
        description: 'Wait for the Wi-Fi row to appear',
        input: { condition: { kind: 'exists', label: 'Wi-Fi' }, timeoutMs: 8000 },
        result: WAIT_TIMEOUT,
      })}
    </>
  ),
}

export const QueryAndWait: Story = {
  render: () => (
    <>
      {tool('query', {
        description: 'Find the Settings icon',
        input: { stateId: 's2', op: 'search', text: 'Settings' },
        result: QUERY_HITS,
      })}
      {tool('query', {
        description: 'Look at the address bar in detail',
        input: { stateId: 's2', op: 'inspect', ref: '@e2' },
        result: JSON.stringify({ stateId: 's2', node: '@e2 textField "Address" #URL' }),
      })}
      {tool('wait_for', {
        description: 'Wait for the General row to appear',
        input: { condition: { kind: 'exists', identifier: 'General' } },
        result: WAIT_VERIFIED,
      })}
      {tool('wait_for', {
        description: 'Check that Safari is already open',
        input: { condition: { kind: 'exists', label: 'Safari' } },
        result: WAIT_PREEXISTING,
      })}
    </>
  ),
}

export const Streaming: Story = {
  render: () => (
    <>
      {tool('snapshot', { description: 'Look at the screen', status: 'streaming' })}
      {tool('act', {
        description: 'Open the Settings app',
        input: { stateId: 's2', actions: [{ type: 'tap', ref: '@e4' }] },
        status: 'streaming',
        elapsedSeconds: 3,
      })}
      {tool('wait_for', {
        description: 'Wait for the list to load',
        input: { condition: { kind: 'exists', label: 'General' } },
        status: 'streaming',
        elapsedSeconds: 12,
      })}
    </>
  ),
}

export const Failures: Story = {
  render: () => (
    <>
      {tool('snapshot', {
        description: 'Look at the screen',
        result: '[Error] NO_DEVICE: No simulator is ready for this session. Boot one from the Activity panel first.',
        isError: true,
      })}
      {tool('act', {
        description: 'Tap the Settings icon',
        input: { stateId: 's1', actions: [{ type: 'tap', ref: '@e4' }] },
        result: '[Error] STALE_STATE: s1 is no longer available. Take a new device_snapshot.',
        isError: true,
      })}
      {tool('act', {
        description: 'Turn the device on its side',
        input: { stateId: 's2', actions: [{ type: 'rotate', orientation: 'landscape-left' }] },
        result: '[denied] User declined the action.',
      })}
    </>
  ),
}

/**
 * Nested under a subagent card: header only, no expand, no summary.
 *
 * `ToolBlock` takes `allowExpand` from nested-tool context rather than a prop, so
 * these mount the block directly.
 */
export const InsideSubagent: Story = {
  render: () => (
    <div className="flex flex-col gap-1 rounded border border-border/60 p-2">
      <DeviceToolBlock
        op="act"
        params={{ description: 'Open the Settings app', actions: [{ type: 'tap', ref: '@e4' }] }}
        result={ACT_WORKED}
        isStreaming={false}
        stallLevel="normal"
        allowExpand={false}
      />
      <DeviceToolBlock
        op="snapshot"
        params={{ description: 'Look at the screen' }}
        result={SNAPSHOT_LANDSCAPE}
        isStreaming={false}
        stallLevel="normal"
        allowExpand={false}
      />
      <DeviceToolBlock
        op="wait_for"
        params={{ description: 'Wait for the Wi-Fi row' }}
        result={WAIT_TIMEOUT}
        isStreaming={false}
        stallLevel="normal"
        allowExpand={false}
      />
    </div>
  ),
}
