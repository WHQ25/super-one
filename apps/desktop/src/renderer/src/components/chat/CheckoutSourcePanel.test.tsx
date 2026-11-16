/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchImportResult, CheckoutFromSourceRequest, CheckoutProgress, CheckoutSourceBranch, CheckoutSourceBranchesResult } from '@superone/shared/agent-types'
import { CheckoutSourcePanel } from './CheckoutSourcePanel'
import { checkoutSourceOptions, type CheckoutSourceOption } from './checkout-sources'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const HEAD = 'c'.repeat(40)
const NODE: CheckoutSourceOption = {
  id: 'node:office', group: 'node', label: 'office',
  source: { kind: 'node', connectionId: 'office', folderPath: 'remote:office:/srv/app' },
}
const PR: CheckoutSourceOption = { id: 'pr', group: 'pr', label: 'Pull Requests', source: { kind: 'pr' } }

function branch(partial: Partial<CheckoutSourceBranch>): CheckoutSourceBranch {
  return { ref: 'feat/x', title: 'feat/x', head: HEAD, localName: 'feat/x', relation: 'new', ...partial }
}

let listed: CheckoutSourceBranchesResult
let listCheckoutSourceBranches: ReturnType<typeof vi.fn>
let progressListener: ((progress: CheckoutProgress) => void) | null
let cancelCheckout: ReturnType<typeof vi.fn>
let checkoutFromSource: ReturnType<typeof vi.fn<(request: CheckoutFromSourceRequest) => Promise<BranchImportResult>>>
let realApp: unknown

beforeEach(() => {
  listed = { ok: true, branches: [branch({})] }
  checkoutFromSource = vi.fn(async (request) => ({ ok: true, branch: request.localName, head: HEAD, status: 'created', snapshot: false }))
  realApp = (window as unknown as Record<string, unknown>).app
  progressListener = null
  cancelCheckout = vi.fn(async () => {})
  listCheckoutSourceBranches = vi.fn(async () => listed)
  ;(window as unknown as Record<string, unknown>).app = {
    listCheckoutSourceBranches,
    checkoutFromSource,
    cancelCheckout,
    onCheckoutProgress: (listener: (progress: CheckoutProgress) => void) => {
      progressListener = listener
      return () => { progressListener = null }
    },
  }
})

afterEach(() => {
  ;(window as unknown as Record<string, unknown>).app = realApp
  vi.clearAllMocks()
})

async function renderPanel(props: Partial<Parameters<typeof CheckoutSourcePanel>[0]> = {}) {
  const onLanded = vi.fn()
  await act(async () => {
    render(<CheckoutSourcePanel folderPath="/repo" options={[NODE, PR]} selected={NODE} onSelectSource={() => {}}
      onBack={() => {}} onLanded={onLanded} {...props} />)
  })
  return onLanded
}

async function click(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

describe('CheckoutSourcePanel', () => {
  it('carries the node checkout\'s uncommitted work by default and can sync without switching', async () => {
    listed = { ok: true, branches: [branch({ relation: 'behind', behind: 2, dirty: { files: 3, insertions: 9, deletions: 1 } })] }
    const onLanded = await renderPanel()
    expect(screen.getByText('↓2')).toBeInTheDocument()
    await click(/feat\/x/)
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    await click('Sync Only')
    expect(checkoutFromSource).toHaveBeenCalledWith({
      folderPath: '/repo', operationId: expect.any(String), source: NODE.source, branch: { ref: 'feat/x', head: HEAD }, localName: 'feat/x', includeWorkingTree: true,
    })
    expect(onLanded).toHaveBeenCalledWith({ branch: 'feat/x', checkout: false })
    expect(toast.success).toHaveBeenCalledWith('Synced feat/x from office', undefined)
  })

  it('creates a renamed branch only under the new name', async () => {
    const onLanded = await renderPanel()
    await click(/feat\/x/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Local branch name' }), { target: { value: 'feat/x-office' } })
    await click('Create and Check Out')
    expect(checkoutFromSource).toHaveBeenCalledWith(expect.objectContaining({ localName: 'feat/x-office', createOnly: true }))
    expect(onLanded).toHaveBeenCalledWith({ branch: 'feat/x-office', checkout: true })
  })

  it('offers overwrite or save-as for a diverged branch', async () => {
    listed = { ok: true, branches: [branch({ relation: 'diverged' })] }
    checkoutFromSource.mockResolvedValueOnce({
      ok: true, branch: 'feat/x', head: HEAD, status: 'updated', snapshot: false, backupBranch: 'superone-backup/feat/x/1234567',
    })
    await renderPanel()
    await click(/feat\/x/)
    expect(screen.getByText('Local feat/x has commits office does not.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Save As' })).toHaveValue('feat/x-office')
    await click('Overwrite and Keep Backup')
    expect(checkoutFromSource).toHaveBeenLastCalledWith(expect.objectContaining({ onDiverged: 'overwrite', localName: 'feat/x' }))
    expect(toast.success).toHaveBeenCalledWith('Synced feat/x from office', {
      description: 'The previous tip is kept as superone-backup/feat/x/1234567',
    })
  })

  it('turns a divergence found while syncing into the same choice', async () => {
    listed = { ok: true, branches: [branch({ relation: 'update' })] }
    checkoutFromSource.mockResolvedValueOnce({ ok: false, reason: 'diverged', branch: 'feat/x' })
    await renderPanel()
    await click(/feat\/x/)
    await click('Sync Only')
    expect(screen.getByRole('button', { name: 'Overwrite and Keep Backup' })).toBeInTheDocument()
  })

  it('explains an old node and a missing gh login', async () => {
    listed = { ok: false, reason: 'unsupported' }
    await renderPanel()
    expect(screen.getByText(/too old to check out from/)).toBeInTheDocument()

    listed = { ok: false, reason: 'unavailable' }
    await renderPanel({ selected: PR })
    expect(screen.getAllByText('Run gh auth login to list pull requests').length).toBeGreaterThan(0)
  })

  it('names failures in a toast', async () => {
    checkoutFromSource.mockResolvedValueOnce({ ok: false, reason: 'conflict', branch: 'feat/x', error: 'would be overwritten' })
    await renderPanel()
    await click(/feat\/x/)
    await click('Create and Check Out')
    expect(toast.error).toHaveBeenCalledWith('Uncommitted changes in the checked-out feat/x would be overwritten', {
      description: 'would be overwritten',
    })
  })
})

describe('checkoutSourceOptions', () => {
  const origin = 'git:git@github.com:acme/app.git'
  const bucket = (connectionId: string, label: string, connection: 'connected' | 'offline', repoIdentity: string) => ({
    environmentId: connectionId, connectionId, label, connection, kind: 'cli-node' as const,
    checkouts: [{ pathKey: `remote:${connectionId}:/srv/app`, repoIdentity }],
  }) as unknown as Parameters<typeof checkoutSourceOptions>[0]['buckets'][number]

  it('lists same-origin environments, remotes, and pull requests with their availability', () => {
    const options = checkoutSourceOptions({
      currentConnectionId: 'local',
      buckets: [
        bucket('local', 'This PC', 'connected', origin),
        bucket('office', 'Office', 'connected', 'git:https://github.com/acme/app'),
        bucket('lab', 'Lab', 'offline', origin),
        bucket('other', 'Other', 'connected', 'git:https://github.com/acme/other'),
      ],
      repoIdentity: origin,
      info: { remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }], github: false },
      pullRequestsLabel: 'Pull Requests',
    })
    expect(options.map((option) => [option.id, option.disabled ?? null])).toEqual([
      ['node:office', null], ['node:lab', 'offline'], ['remote:origin', null], ['pr', 'gh-unavailable'],
    ])
    expect(options[2]!.detail).toBe('github.com/acme/app')
  })

  it('offers this computer and the other environments to a node checkout, without remotes', () => {
    const options = checkoutSourceOptions({
      currentConnectionId: 'office',
      buckets: [bucket('local', 'This PC', 'connected', origin), bucket('office', 'Office', 'connected', origin), bucket('lab', 'Lab', 'connected', origin)],
      repoIdentity: origin,
      info: null,
      pullRequestsLabel: 'Pull Requests',
    })
    expect(options.map((option) => option.id)).toEqual(['node:local', 'node:lab'])
    expect(options[0]!.source).toEqual({ kind: 'node', connectionId: 'local', folderPath: 'remote:local:/srv/app' })
  })
})

describe('CheckoutSourcePanel progress', () => {
  it('shows transfer bytes, cancels on request, and reports a cancelled run without an error', async () => {
    let finish!: (result: BranchImportResult) => void
    checkoutFromSource.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await renderPanel()
    await click(/feat\/x/)
    await click('Create Only')
    const operationId = checkoutFromSource.mock.calls[0]![0].operationId!
    expect(operationId).toBeTruthy()

    await act(async () => { progressListener?.({ operationId, phase: 'downloading', done: 512 * 1024, total: 2 * 1024 * 1024 }) })
    expect(screen.getByRole('status')).toHaveTextContent('Downloading 512.0 KB / 2.0 MB')
    // Another run's events are ignored.
    await act(async () => { progressListener?.({ operationId: 'other', phase: 'applying' }) })
    expect(screen.getByRole('status')).toHaveTextContent('Downloading')

    await click('Cancel')
    expect(cancelCheckout).toHaveBeenCalledWith(operationId)
    await act(async () => { finish({ ok: false, reason: 'cancelled' }) })
    expect(toast.info).toHaveBeenCalledWith('Cancelled. Nothing was changed.')
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('cannot cancel once the target is changing', async () => {
    checkoutFromSource.mockImplementationOnce(() => new Promise(() => {}))
    await renderPanel()
    await click(/feat\/x/)
    await click('Create Only')
    const operationId = checkoutFromSource.mock.calls[0]![0].operationId!
    await act(async () => { progressListener?.({ operationId, phase: 'applying' }) })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('CheckoutSourcePanel git remote listing', () => {
  const ORIGIN: CheckoutSourceOption = { id: 'remote:origin', group: 'remote', label: 'origin', source: { kind: 'remote', remote: 'origin' } }

  it('shows the last-fetched branches at once and fetches when they are stale', async () => {
    let fetched!: (result: CheckoutSourceBranchesResult) => void
    listCheckoutSourceBranches
      .mockResolvedValueOnce({ ok: true, branches: [branch({ ref: 'old', title: 'origin/old' })], fetchedAt: Date.now() - 60 * 60_000 })
      .mockImplementationOnce(() => new Promise((resolve) => { fetched = resolve }))
    await renderPanel({ selected: ORIGIN })
    expect(screen.getByText('origin/old')).toBeInTheDocument()
    expect(screen.getByText('Fetching origin…')).toBeInTheDocument()
    expect(listCheckoutSourceBranches).toHaveBeenLastCalledWith('/repo', ORIGIN.source, { fetch: true })

    await act(async () => { fetched({ ok: true, branches: [branch({ ref: 'new', title: 'origin/new' })], fetchedAt: Date.now() }) })
    expect(screen.getByText('origin/new')).toBeInTheDocument()
    expect(screen.getByText('Fetched just now')).toBeInTheDocument()
  })

  it('skips the fetch when the last one is recent, and fetches again on request', async () => {
    listed = { ok: true, branches: [branch({})], fetchedAt: Date.now() - 60_000 }
    await renderPanel({ selected: ORIGIN })
    expect(listCheckoutSourceBranches).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Fetched 1m ago')).toBeInTheDocument()
    await click('Fetch Again')
    expect(listCheckoutSourceBranches).toHaveBeenLastCalledWith('/repo', ORIGIN.source, { fetch: true })
  })

  it('keeps the listed branches when the background fetch fails', async () => {
    listCheckoutSourceBranches
      .mockResolvedValueOnce({ ok: true, branches: [branch({ title: 'origin/kept' })] })
      .mockResolvedValueOnce({ ok: false, reason: 'error', error: 'network down' })
    await renderPanel({ selected: ORIGIN })
    expect(screen.getByText('origin/kept')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Could not fetch origin', { description: 'network down' })
  })
})
