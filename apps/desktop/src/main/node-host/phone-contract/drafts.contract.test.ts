import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDraftStore, DraftControl } from '@superone/runtime/drafts'
import type { DraftListEntry, DraftOpenResult } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

function draftsDomain(beforeDraftOpen?: (draftId: string) => Promise<void>) {
  const db = new Database(':memory:')
  cleanup.push(() => db.close())
  const drafts = new DraftControl(createDraftStore(db))
  return { ...phoneDomain(cleanup, { drafts, beforeDraftOpen }), drafts }
}

const picture = { id: 'chip-a', name: 'a.png', mimeType: 'image/png', data: 'AAAA' }

describe('phone endpoint: drafts', () => {
  it('flushes the desktop composer before taking its draft and refuses a failed flush', async () => {
    let flush!: () => void
    const prepare = vi.fn(() => new Promise<void>(resolve => { flush = resolve }))
    const { domain, drafts, projectDir } = draftsDomain(prepare)
    drafts.upsert({ id: 'flush', text: 'old', projectPath: projectDir })
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const opening = phone.rpc<DraftOpenResult>('draft.open', { draftId: 'flush' })
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith('flush'))
    expect(drafts.get('flush')?.controllerDeviceId).toBeNull()
    drafts.upsert({ id: 'flush', text: 'last keystroke', projectPath: projectDir })
    flush()
    expect((await opening).draft.text).toBe('last keystroke')
    prepare.mockImplementationOnce(() => Promise.reject(new Error('composer did not save')))
    drafts.upsert({ id: 'failed', text: 'unsaved', projectPath: projectDir })
    await expect(phone.rpc('draft.open', { draftId: 'failed' })).rejects.toThrow('composer did not save')
    expect(drafts.get('failed')?.controllerDeviceId).toBeNull()
  })

  it('returns a live open lease when the same request is retried after disconnect', async () => {
    const { domain, drafts, projectDir } = draftsDomain()
    drafts.upsert({ id: 'retry', text: 'draft', projectPath: projectDir })
    const phone = await connectPhone(domain)
    cleanup.push(phone.close)
    const first = await phone.rpc<DraftOpenResult>('draft.open', { draftId: 'retry' }, 'same-open')
    expect((await phone.rpc<DraftOpenResult>('draft.open', { draftId: 'retry' }, 'same-open')).leaseId).toBe(first.leaseId)
    drafts.releaseDevice('phone:phone-1')
    const reopened = await phone.rpc<DraftOpenResult>('draft.open', { draftId: 'retry' }, 'same-open')
    expect(reopened.leaseId).not.toBe(first.leaseId)
    expect(() => drafts.assertControl('retry', 'phone:phone-1', reopened.leaseId)).not.toThrow()
    await expect(phone.rpc('draft.upsert', { id: 'retry', text: 'late stale save', projectPath: projectDir, leaseId: first.leaseId })).rejects.toThrow('Draft control was released')
    expect(drafts.get('retry')?.text).toBe('draft')
  })

  it('lists without attachment bytes, opens under a lease and keeps other writers out until closed', async () => {
    const { domain, drafts, projectDir } = draftsDomain()
    drafts.upsert({ id: 'd1', text: 'desktop text', projectPath: projectDir, attachments: [picture] })
    const phone = await connectPhone(domain)

    const { drafts: listed } = await phone.rpc<{ drafts: DraftListEntry[] }>('draft.list', { omitAttachmentData: true })
    expect(listed[0].attachments?.[0].data).toBe('')

    const opened = await phone.rpc<DraftOpenResult>('draft.open', { draftId: 'd1' })
    expect(opened.draft.attachments?.[0].data).toBe('AAAA')
    expect(() => drafts.upsert({ id: 'd1', text: 'stale desktop text' })).toThrow(/read only/i)

    const saved = await phone.rpc<DraftOpenResult>('draft.upsert', { id: 'd1', text: 'phone text', projectPath: projectDir, leaseId: opened.leaseId })
    expect(saved).toMatchObject({ leaseId: opened.leaseId, draft: { text: 'phone text' } })
    await phone.rpc('draft.close', { draftId: 'd1', leaseId: opened.leaseId })
    expect(drafts.upsert({ id: 'd1', text: 'desktop again' }).text).toBe('desktop again')
  })

  it('creates a new draft under its lease and refuses a stale open', async () => {
    const { domain, drafts, projectDir } = draftsDomain()
    const phone = await connectPhone(domain)
    const created = await phone.rpc<DraftOpenResult>('draft.upsert', { id: 'd2', text: 'new', projectPath: projectDir, open: true, attachments: [picture] })
    expect(created.leaseId).toBeTruthy()
    expect(drafts.get('d2')?.controllerDeviceId).toBe('phone:phone-1')
    expect(drafts.get('d2')?.attachments?.[0]).toEqual(picture)
    await phone.rpc('draft.close', { draftId: 'd2', leaseId: created.leaseId })
    await expect(phone.rpc('draft.open', { draftId: 'd2', expectedUpdatedAt: 'old' })).rejects.toThrow(/changed on another device/)
  })

  it('pushes draft changes to phones following drafts', async () => {
    const { domain, drafts, projectDir } = draftsDomain()
    const phone = await connectPhone(domain, { transport: 'lan' })
    const { snapshotSequence } = await phone.rpc<{ snapshotSequence: string }>('session.snapshot')
    await phone.rpc('topic.subscribe', { subscriptionId: 's', afterSequence: snapshotSequence, topics: [{ kind: 'drafts', environmentId: domain.identity.environmentId }] })
    drafts.upsert({ id: 'd3', text: 'typed', projectPath: projectDir, attachments: [picture] })
    await vi.waitFor(() => expect(phone.pushes).toContainEqual(expect.objectContaining({
      type: 'draft', subscriptionId: 's', event: expect.objectContaining({ draftId: 'd3', reason: 'saved' }),
    })))
    const pushed = phone.pushes.find((m) => m.type === 'draft') as { event: { draft: DraftListEntry } }
    expect(pushed.event.draft.attachments?.[0].data).toBe('')
  })
})
