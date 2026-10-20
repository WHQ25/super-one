/**
 * Sidebar delete must actually drop the draft. A later upsert (visibility
 * flush, in-flight save) or list refresh used to put the same id back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftListEntry, DraftUpsertRequest } from '@superone/shared/environment'

const listDrafts = vi.fn()
const upsertDraft = vi.fn()
const deleteDraft = vi.fn()
const openDraft = vi.fn()
const closeDraft = vi.fn()

vi.stubGlobal('window', {
  environment: { listDrafts, upsertDraft, deleteDraft, openDraft, closeDraft },
  app: { trace: vi.fn() },
})

const { useDraftsStore } = await import('./drafts')

function entry(partial: Partial<DraftListEntry> & Pick<DraftListEntry, 'id' | 'text'>): DraftListEntry {
  return {
    title: partial.text,
    docJson: null,
    attachments: [],
    projectPath: '/repo',
    harness: null,
    model: null,
    permissionMode: null,
    settings: {},
    originSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    pendingSync: false,
    ...partial,
  } as DraftListEntry
}

function request(id: string, text: string): DraftUpsertRequest {
  return { id, text, projectPath: '/repo' }
}

beforeEach(() => {
  listDrafts.mockReset()
  upsertDraft.mockReset()
  deleteDraft.mockReset()
  deleteDraft.mockResolvedValue(undefined)
  upsertDraft.mockImplementation(async (_cid: string, draft: DraftUpsertRequest) =>
    entry({ id: draft.id, text: draft.text, projectPath: draft.projectPath ?? '/repo' }),
  )
  openDraft.mockReset()
  closeDraft.mockReset()
  closeDraft.mockResolvedValue(undefined)
  useDraftsStore.setState({
    byConnection: {},
    loading: {},
    resumingDraftId: null,
    discardedIds: {},
    leases: {},
  })
})

describe('opening a remote draft', () => {
  it('keeps the lease and sends it with the next save, without locking the composer', async () => {
    useDraftsStore.setState({
      byConnection: { remote: [entry({ id: 'd1', text: 'stale', controllerDeviceId: 'host-window' })] },
    })
    openDraft.mockResolvedValue({
      leaseId: 'lease-1',
      draft: entry({ id: 'd1', text: 'flushed', controllerDeviceId: 'controller' }),
    })
    const opened = await useDraftsStore.getState().openDraft('remote', 'd1')
    expect(opened.controllerDeviceId).toBeNull()
    expect(opened.text).toBe('flushed')
    expect(useDraftsStore.getState().byConnection.remote?.[0]?.controllerDeviceId).toBeNull()

    await useDraftsStore.getState().saveDraft('remote', request('d1', 'edited'))
    expect(upsertDraft).toHaveBeenCalledWith('remote', expect.objectContaining({ id: 'd1', text: 'edited', leaseId: 'lease-1' }))
    expect(useDraftsStore.getState().byConnection.remote?.[0]?.controllerDeviceId).toBeNull()

    await useDraftsStore.getState().closeLease('remote', 'd1')
    expect(closeDraft).toHaveBeenCalledWith('remote', 'd1', 'lease-1')
    expect(useDraftsStore.getState().leases['d1']).toBeUndefined()
  })
})

describe('deleting a draft', () => {
  it('does not put the same id back when a later upsert races in (visibility flush)', async () => {
    await useDraftsStore.getState().saveDraft('local', request('d1', 'old idea'))
    await useDraftsStore.getState().saveDraft('local', request('d2', 'keep me'))
    expect(useDraftsStore.getState().byConnection.local?.map((d) => d.id)).toEqual(['d2', 'd1'])

    await useDraftsStore.getState().discardDraft('local', 'd1')
    expect(useDraftsStore.getState().byConnection.local?.map((d) => d.id)).toEqual(['d2'])

    // App hide / pagehide re-promotes every unsent composer, including the
    // origin session that still holds the deleted text.
    upsertDraft.mockClear()
    await useDraftsStore.getState().saveDraft('local', request('d1', 'old idea'))

    expect(useDraftsStore.getState().byConnection.local?.map((d) => d.id)).toEqual(['d2'])
    expect(upsertDraft).not.toHaveBeenCalled()
  })

  it('does not resurrect a deleted row when listDrafts still returns it', async () => {
    useDraftsStore.setState({
      byConnection: { local: [entry({ id: 'd1', text: 'gone' }), entry({ id: 'd2', text: 'stay' })] },
    })
    await useDraftsStore.getState().discardDraft('local', 'd1')

    listDrafts.mockResolvedValue([
      entry({ id: 'd1', text: 'gone' }),
      entry({ id: 'd2', text: 'stay' }),
    ])
    await useDraftsStore.getState().loadDrafts('local')

    expect(useDraftsStore.getState().byConnection.local?.map((d) => d.id)).toEqual(['d2'])
  })

  it('drops the row immediately and undoes an in-flight upsert that lands after delete', async () => {
    let finishUpsert!: (value: DraftListEntry) => void
    upsertDraft.mockImplementationOnce(
      () =>
        new Promise<DraftListEntry>((resolve) => {
          finishUpsert = resolve
        }),
    )

    const save = useDraftsStore.getState().saveDraft('local', request('d1', 'still typing'))
    await useDraftsStore.getState().discardDraft('local', 'd1')
    expect(useDraftsStore.getState().byConnection.local ?? []).toEqual([])

    finishUpsert(entry({ id: 'd1', text: 'still typing' }))
    await save

    expect(useDraftsStore.getState().byConnection.local ?? []).toEqual([])
    expect(deleteDraft).toHaveBeenCalledWith('local', 'd1')
  })

  it('still allows resume to re-promote after removeDraft (no tombstone)', async () => {
    await useDraftsStore.getState().saveDraft('local', request('d1', 'open me'))
    await useDraftsStore.getState().removeDraft('local', 'd1')
    expect(useDraftsStore.getState().byConnection.local ?? []).toEqual([])

    await useDraftsStore.getState().saveDraft('local', request('d1', 'open me'))
    expect(useDraftsStore.getState().byConnection.local?.map((d) => d.id)).toEqual(['d1'])
  })
})
