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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
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

// Shaped exactly like `listDeviceGroups` returns it, so the row is exercised against
// the real payload rather than a convenient one.
const DEVICE_LIST = JSON.stringify({
  groups: [{
    id: 'ios-simulator',
    name: 'iOS Simulator',
    devices: [
      { id: '427A175E', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4', running: true, controlled: true },
      { id: 'B3C1', name: 'iPhone 17', platform: 'iOS 26.4', running: true, busy: true },
      { id: 'D9F2', name: 'iPad Pro 13-inch (M4)', platform: 'iPadOS 26.4', running: false },
    ],
  }],
  controlled: { id: '427A175E', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
  note: 'This session already controls a device; the other device tools are ready.',
})

const DEVICE_LIST_EMPTY = JSON.stringify({
  groups: [],
  controlled: null,
  note: 'No simulators exist on this machine. Create one in Xcode (or the Activity panel) first.',
})

const BOOT_STARTED = JSON.stringify({
  running: true,
  alreadyRunning: false,
  controlled: false,
  device: { id: '427A175E', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
  note: 'The device is running, but nothing is driving it yet.',
})

const BOOT_ALREADY = JSON.stringify({
  running: true,
  alreadyRunning: true,
  controlled: false,
  device: { id: '427A175E', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
  note: 'The device is running, but nothing is driving it yet.',
})

const BOOT_REFUSED = '[Error] NO_DEVICE: iPhone cannot be started from here — a ios device of '
  + 'this kind is either a real device someone else turns on, or already running.'

const CONTROL_GRANTED = JSON.stringify({
  controlled: true,
  alreadyControlled: false,
  device: { id: '427A175E', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
  note: 'This session now controls the device. Install a build with `xcrun simctl install <udid> <path>`.',
})

const CONTROL_ALREADY = JSON.stringify({
  controlled: true,
  alreadyControlled: true,
  device: { id: '427A175E', name: 'iPhone 17 Pro Max', platform: 'iOS 26.4' },
  note: 'This session now controls the device.',
})

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Device',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

/** How a run starts: read the catalog, then ask for one device by name. */
export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell>
      <Note>Device UI grouped in the same family-first format as Automation.</Note>
      <Section title="Discovery">
        {tool('list', { description: '', result: DEVICE_LIST })}
      </Section>
      <Section title="Boot">
        {tool('boot', {
          description: 'Start the simulator while the build runs',
          input: { device: '427A175E' },
          result: BOOT_STARTED,
        })}
      </Section>
      <Section title="Control">
        {tool('request_control', {
          description: 'Drive the app on the simulator',
          input: { device: '427A175E' },
          result: CONTROL_GRANTED,
        })}
      </Section>
      <Section title="Snapshot / wait">
        {tool('snapshot', { description: 'Look at the Safari screen', result: SNAPSHOT })}
        {tool('snapshot', {
          description: 'Check the screen after rotating',
          result: SNAPSHOT_LANDSCAPE,
        })}
        {tool('wait_for', {
          description: 'Wait for the General row to appear',
          input: { condition: { kind: 'exists', identifier: 'General' } },
          result: WAIT_VERIFIED,
        })}
      </Section>
      <Section title="Action">
        {tool('act', {
          description: 'Open the Settings app',
          input: { stateId: 's2', actions: [{ type: 'tap', ref: '@e4' }] },
          result: ACT_WORKED,
        })}
        {tool('act', {
          description: 'Turn the device on its side',
          input: { stateId: 's4', actions: [{ type: 'rotate', orientation: 'landscape-left' }] },
          result: ACT_WORKED,
        })}
      </Section>
      <Section title="Query">
        {tool('query', {
          description: 'Find the Settings icon',
          input: { stateId: 's2', op: 'search', text: 'Settings' },
          result: QUERY_HITS,
        })}
      </Section>
    </StoryShell>
  ),
}

export const DeviceList: Story = {
  name: 'device_list',
  render: () => (
    <StoryShell>
      {tool('list', { description: '', result: DEVICE_LIST })}
      {tool('list', { description: '', result: DEVICE_LIST_EMPTY })}
    </StoryShell>
  ),
}

export const DeviceBoot: Story = {
  name: 'device_boot',
  render: () => (
    <StoryShell>
      {tool('boot', { description: 'Start the simulator while the build runs', input: { device: '427A175E' }, result: BOOT_STARTED })}
      {tool('boot', { description: 'Start the simulator while the build runs', input: { device: '427A175E' }, result: BOOT_ALREADY })}
      {tool('boot', { description: 'Start the paired iPhone', input: { device: 'iPhone' }, status: 'streaming', elapsedSeconds: 8 })}
      {tool('boot', { description: 'Start the paired iPhone', input: { device: 'iPhone' }, result: BOOT_REFUSED, isError: true })}
    </StoryShell>
  ),
}

export const DeviceRequestControl: Story = {
  name: 'device_request_control',
  render: () => (
    <StoryShell>
      {tool('request_control', { description: 'Drive the app on the simulator', input: { device: '427A175E' }, result: CONTROL_GRANTED })}
      {tool('request_control', { description: 'Drive the app on the simulator', input: { device: '427A175E' }, result: CONTROL_ALREADY })}
    </StoryShell>
  ),
}

export const DeviceSnapshot: Story = {
  name: 'device_snapshot',
  render: () => (
    <StoryShell>
      {tool('snapshot', { description: 'Look at the Safari screen', result: SNAPSHOT })}
      {tool('snapshot', { description: 'Capture the settled screen', result: FUSED })}
    </StoryShell>
  ),
}

export const DeviceQuery: Story = {
  name: 'device_query',
  render: () => (
    <StoryShell>
      {tool('query', { description: 'Find the Settings icon', input: { stateId: 's2', op: 'search', text: 'Settings' }, result: QUERY_HITS })}
    </StoryShell>
  ),
}

export const DeviceAct: Story = {
  name: 'device_act',
  render: () => (
    <StoryShell>
      {tool('act', { description: 'Open the Settings app', input: { stateId: 's2', actions: [{ type: 'tap', ref: '@e4' }] }, result: ACT_WORKED })}
      {tool('act', { description: 'Turn the device on its side', input: { stateId: 's4', actions: [{ type: 'rotate', orientation: 'landscape-left' }] }, result: ACT_DIDNT })}
    </StoryShell>
  ),
}

export const DeviceWaitFor: Story = {
  name: 'device_wait_for',
  render: () => (
    <StoryShell>
      {tool('wait_for', { description: 'Wait for the General row to appear', input: { condition: { kind: 'exists', identifier: 'General' } }, result: WAIT_VERIFIED })}
      {tool('wait_for', { description: 'Wait for Wi-Fi to appear', input: { condition: { kind: 'exists', identifier: 'Wi-Fi' } }, result: WAIT_TIMEOUT })}
    </StoryShell>
  ),
}
