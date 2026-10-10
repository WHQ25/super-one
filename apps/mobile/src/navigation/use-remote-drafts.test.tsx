import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useRef } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { useComposerDraft } from './use-composer-draft'
import { useRemoteDrafts } from './use-remote-drafts'
import { composerFromRemoteDraft } from '../remote-draft-codec'
import { EMPTY_COMPOSER_DRAFT } from '../composer-draft-state'

test('parks one new draft and starts another without restoring the outgoing text', async () => {
  const rows = new Map<string, DraftListEntry>()
  const commands: Array<{ method: string; payload: Record<string, unknown> }> = []
  const storage = new Map<string, string>()
  const kv = { get: async (key: string) => storage.get(key) ?? null, set: async (key: string, value: string) => { storage.set(key, value) } }
  const rpc = async (method: string, payload: Record<string, unknown>) => {
    commands.push({ method, payload })
    if (method === 'draft.list') return { drafts: [...rows.values()] }
    if (method === 'draft.upsert') {
      const draft = { ...payload, title: payload.text, updatedAt: 'now', createdAt: 'now' } as DraftListEntry
      rows.set(draft.id, draft)
      return { draft, leaseId: `lease-${draft.id}` }
    }
    if (method === 'draft.open') return { draft: rows.get(String(payload.draftId)), leaseId: `lease-${payload.draftId}` }
    return { ok: true }
  }
  const errors = jest.fn()
  const { result, unmount } = await renderHook(() => {
    const composer = useComposerDraft()
    const clientRef = useRef({ rpc } as unknown as RelayClient)
    const library = useRemoteDrafts({ kv, pairingId: 'desktop', clientRef, composer, attachments: [], projectPath: '/repo', sessionId: null,
      settings: { harness: 'codex', codexModel: 'saved-model' },
      apply: async (row) => composer.replaceWith(composerFromRemoteDraft(row)), onError: errors,
      onRevoked: () => composer.replaceWith(EMPTY_COMPOSER_DRAFT) })
    return { composer, library }
  })
  await act(async () => { result.current.composer.changeText('first draft') })
  await act(async () => {
    await result.current.library.park()
    result.current.composer.replaceWith(EMPTY_COMPOSER_DRAFT)
    result.current.library.begin()
  })
  expect(rows.size).toBe(1)
  const first = [...rows.values()][0]
  expect(commands).toContainEqual({ method: 'draft.close', payload: { draftId: first.id, leaseId: `lease-${first.id}` } })
  await act(async () => { result.current.composer.changeText('second draft') })
  await act(async () => { await result.current.library.open(first) })
  expect(rows.size).toBe(2)
  expect(result.current.composer.draft).toBe('first draft')
  expect(result.current.library.activeId).toBe(first.id)
  expect(errors).not.toHaveBeenCalled()
  await unmount()
})
