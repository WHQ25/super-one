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
}

function stub(overrides: Partial<{ usage: SyncZoneUsage; freed: number }> = {}) {
  const getSyncZoneUsage = vi.fn().mockResolvedValue(overrides.usage ?? usage)
  const reclaimSyncZone = vi.fn().mockResolvedValue({ removed: ['a', 'b', 'c'], freedBytes: overrides.freed ?? usage.reclaimable.bytes })
  const revealFile = vi.fn().mockResolvedValue(undefined)
  Object.assign(window.app, { getSyncZoneUsage, reclaimSyncZone, revealFile })
  return { getSyncZoneUsage, reclaimSyncZone, revealFile }
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
