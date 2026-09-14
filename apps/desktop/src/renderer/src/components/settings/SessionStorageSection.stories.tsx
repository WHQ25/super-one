import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { SyncZoneUsage } from '@superone/shared/environment'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { SessionStorageSection } from './SessionStorageSection'

const GB = 1024 ** 3
const MB = 1024 ** 2

const BASE: SyncZoneUsage = {
  root: '/Users/dev/Library/Application Support/SuperOne/sync',
  totalBytes: 3.2 * GB,
  sessionCount: 42,
  adhocBytes: 12 * MB,
  pendingBytes: 0,
  reclaimable: { sessions: 0, bytes: 0 },
}

let usage: SyncZoneUsage = { ...BASE }
let usageDelay = 0
let fail = false

mockIpc('app', 'getSyncZoneUsage', async () => {
  await new Promise((r) => setTimeout(r, usageDelay))
  if (fail) throw new Error('EACCES')
  return usage
})
mockIpc('app', 'reclaimSyncZone', async () => {
  await new Promise((r) => setTimeout(r, 900))
  const freed = usage.reclaimable.bytes
  usage = {
    ...usage,
    totalBytes: usage.totalBytes - freed,
    sessionCount: usage.sessionCount - usage.reclaimable.sessions,
    reclaimable: { sessions: 0, bytes: 0 },
  }
  return { removed: [], freedBytes: freed }
})
mockIpc('app', 'revealFile', async (path: unknown) => console.log('reveal', path))

/** The section reads its numbers on mount, so a story seeds the mock during render — before that effect runs. */
function seed(patch: Partial<SyncZoneUsage>, opts: { delay?: number; fail?: boolean } = {}) {
  return (Story: () => ReactElement) => {
    usage = { ...BASE, ...patch }
    usageDelay = opts.delay ?? 0
    fail = opts.fail ?? false
    return <Story />
  }
}

const meta: Meta<typeof SessionStorageSection> = {
  title: 'Settings/SessionStorage',
  component: SessionStorageSection,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SessionStorageSection>

/** Steady state: sessions all still known, so the sweep has nothing to offer and the button says so by being disabled. */
export const NothingToReclaim: Story = { decorators: [seed({})] }

/** Three finished sessions the sweep would remove — press "Reclaim Now" to watch the numbers re-read. */
export const Reclaimable: Story = {
  decorators: [seed({ reclaimable: { sessions: 3, bytes: 700 * MB } })],
}

/** An upload still queued to a node: shown so the person knows why that part of the total is not going anywhere. */
export const UploadPending: Story = {
  decorators: [seed({ pendingBytes: 200 * MB, reclaimable: { sessions: 1, bytes: 40 * MB } })],
}

/** A fresh install — nothing has been captured yet. */
export const Empty: Story = {
  decorators: [seed({ totalBytes: 0, sessionCount: 0, adhocBytes: 0 })],
}

/** The read is still in flight. */
export const Loading: Story = { decorators: [seed({}, { delay: 60_000 })] }

/** The folder could not be read — say so rather than show a zero. */
export const Unreadable: Story = { decorators: [seed({}, { fail: true })] }

/** Narrow settings pane: buttons must not squash the figures. */
export const Narrow: Story = {
  decorators: [
    seed({ reclaimable: { sessions: 12, bytes: 2.4 * GB }, pendingBytes: 1.1 * GB }),
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
}
