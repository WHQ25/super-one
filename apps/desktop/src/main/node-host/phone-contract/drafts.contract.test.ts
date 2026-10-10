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

function draftsDomain() {
  const db = new Database(':memory:')
  cleanup.push(() => db.close())
  const drafts = new DraftControl(createDraftStore(db))
  return { ...phoneDomain(cleanup, { drafts }), drafts }
}

const picture = { name: 'a.png', mimeType: 'image/png', data: 'AAAA' }

describe('phone endpoint: drafts', () => {
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
    const created = await phone.rpc<DraftOpenResult>('draft.upsert', { id: 'd2', text: 'new', projectPath: projectDir, open: true })
    expect(created.leaseId).toBeTruthy()
    expect(drafts.get('d2')?.controllerDeviceId).toBe('phone:phone-1')
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
