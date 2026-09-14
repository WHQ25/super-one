/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncZoneUsage } from '@superone/shared/environment'
import { SessionStorageSection } from './SessionStorageSection'

const usage: SyncZoneUsage = {
  root: '/Users/me/Library/Application Support/SuperOne/sync',
  totalBytes: 3 * 1024 * 1024 * 1024,
  sessionCount: 42,
  adhocBytes: 12 * 1024 * 1024,
  pendingBytes: 200 * 1024 * 1024,
  reclaimable: { sessions: 3, bytes: 700 * 1024 * 1024 },
  failedHandoffs: { files: 0, bytes: 0, lastError: null },
}

function stub(overrides: Partial<{ usage: SyncZoneUsage; freed: number }> = {}) {
  const getSyncZoneUsage = vi.fn().mockResolvedValue(overrides.usage ?? usage)
  const reclaimSyncZone = vi.fn().mockResolvedValue({ removed: ['a', 'b', 'c'], freedBytes: overrides.freed ?? usage.reclaimable.bytes })
  const revealFile = vi.fn().mockResolvedValue(undefined)
  const retrySyncZoneHandoffs = vi.fn().mockResolvedValue({ retried: 2, recovered: 2 })
  Object.assign(window.app, { getSyncZoneUsage, reclaimSyncZone, revealFile, retrySyncZoneHandoffs })
  return { getSyncZoneUsage, reclaimSyncZone, revealFile, retrySyncZoneHandoffs }
}

beforeEach(() => { stub() })

describe('session storage settings', () => {
  it('shows how much the sessions hold, what is still uploading, and what a sweep would free', async () => {
    // There is no cap. The numbers are the decision aid; the sweep is the
    // person's to run.
    render(<SessionStorageSection />)
    expect(await screen.findByText(/3\.0 GB/)).toBeInTheDocument()
    expect(screen.getByText(/42 sessions/)).toBeInTheDocument()
    expect(screen.getByText(/200\.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/700\.0 MB/)).toBeInTheDocument()
  })

  it('hides the retry affordance entirely while nothing is stuck', async () => {
    render(<SessionStorageSection />)
    await screen.findByText(/3\.0 GB/)
    expect(screen.queryByTestId('session-storage-stuck')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry upload/i })).not.toBeInTheDocument()
  })

  it('names the files that could not be queued and why, and offers to try again', async () => {
    // These have no job row, so no worker is coming for them — unlike
    // `pendingBytes`, this number only moves if a person or a reconnect acts.
    const stuck: SyncZoneUsage = { ...usage, failedHandoffs: { files: 2, bytes: 5 * 1024 * 1024, lastError: 'SQLITE_BUSY' } }
    const { retrySyncZoneHandoffs, getSyncZoneUsage } = stub({ usage: stuck })
    render(<SessionStorageSection />)
    expect(await screen.findByTestId('session-storage-stuck')).toHaveTextContent(/5\.0 MB in 2 files/)
    expect(screen.getByTestId('session-storage-stuck')).toHaveTextContent(/SQLITE_BUSY/)

    await userEvent.click(screen.getByRole('button', { name: /retry upload/i }))
    await waitFor(() => expect(retrySyncZoneHandoffs).toHaveBeenCalledTimes(1))
    // Re-read, because a recovered handoff changes both figures.
    await waitFor(() => expect(getSyncZoneUsage).toHaveBeenCalledTimes(2))
  })

  it('runs the sweep on request, says what it freed, and re-reads the numbers', async () => {
    const { reclaimSyncZone, getSyncZoneUsage } = stub({ freed: 700 * 1024 * 1024 })
    render(<SessionStorageSection />)
    await screen.findByText(/3\.0 GB/)
    await userEvent.click(screen.getByRole('button', { name: /reclaim now/i }))
    await waitFor(() => expect(reclaimSyncZone).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/freed 700\.0 MB/i)).toBeInTheDocument()
    await waitFor(() => expect(getSyncZoneUsage).toHaveBeenCalledTimes(2))
  })

  it('disables the sweep when nothing would go, rather than offering a button that does nothing', async () => {
    stub({ usage: { ...usage, reclaimable: { sessions: 0, bytes: 0 } } })
    render(<SessionStorageSection />)
    await screen.findByText(/3\.0 GB/)
    expect(screen.getByRole('button', { name: /reclaim now/i })).toBeDisabled()
  })

  it('opens the directory in the file manager', async () => {
    const { revealFile } = stub()
    render(<SessionStorageSection />)
    await screen.findByText(/3\.0 GB/)
    await userEvent.click(screen.getByRole('button', { name: /show in finder|show in folder/i }))
    expect(revealFile).toHaveBeenCalledWith(usage.root)
  })

  it('says so when the numbers cannot be read, instead of showing zero', async () => {
    Object.assign(window.app, { getSyncZoneUsage: vi.fn().mockRejectedValue(new Error('EACCES')) })
    render(<SessionStorageSection />)
    expect(await screen.findByText(/could not read/i)).toBeInTheDocument()
  })
})
