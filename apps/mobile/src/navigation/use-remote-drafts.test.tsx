import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useRef, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { DraftListEntry, DraftSessionSettings } from '@superone/shared/environment/draft-rpc'
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

function draftHarness(initial: DraftSessionSettings) {
  const rows = new Map<string, DraftListEntry>()
  const commands: Array<{ method: string; payload: Record<string, unknown> }> = []
  const storage = new Map<string, string>()
  const kv = { get: async (key: string) => storage.get(key) ?? null, set: async (key: string, value: string) => { storage.set(key, value) } }
  const rpc = async (method: string, payload: Record<string, unknown>) => {
    commands.push({ method, payload })
    if (method === 'draft.list') return { drafts: [...rows.values()] }
    if (method === 'draft.upsert') {
      const draft = { ...payload, title: payload.text, updatedAt: 'now', createdAt: payload.createdAt ?? 'now' } as DraftListEntry
      rows.set(draft.id, draft)
      return { draft, leaseId: `lease-${draft.id}` }
    }
    if (method === 'draft.open') return { draft: rows.get(String(payload.draftId)), leaseId: `lease-${payload.draftId}` }
    return { ok: true }
  }
  return { rows, commands, render: () => renderHook(() => {
    const [settings, setSettings] = useState(initial)
    const composer = useComposerDraft()
    const clientRef = useRef({ rpc } as unknown as RelayClient)
    const library = useRemoteDrafts({
      kv, pairingId: 'desktop', clientRef, composer, attachments: [], projectPath: '/repo', sessionId: null, settings,
      apply: async (row) => composer.replaceWith(composerFromRemoteDraft(row)),
      onError: jest.fn(),
      onRevoked: () => composer.replaceWith(EMPTY_COMPOSER_DRAFT),
    })
    return { composer, library, setSettings }
  }) }
}

async function saveDraft(result: { current: { composer: ReturnType<typeof useComposerDraft>; library: ReturnType<typeof useRemoteDrafts> } }, text: string) {
  await act(async () => { result.current.composer.changeText(text) })
  await act(async () => {
    await result.current.library.park()
    result.current.composer.replaceWith(EMPTY_COMPOSER_DRAFT)
    result.current.library.begin()
  })
}

function lastUpsert(commands: Array<{ method: string; payload: Record<string, unknown> }>, id: string) {
  return commands.filter((command) => command.method === 'draft.upsert' && command.payload.id === id).at(-1)
}

test('an opened draft keeps its saved environment when the phone routes elsewhere', async () => {
  const harness = draftHarness({ harness: 'codex', environmentId: 'mac' })
  const { result, unmount } = await harness.render()
  await saveDraft(result, 'saved on mac')
  const saved = [...harness.rows.values()][0]
  await act(async () => { result.current.setSettings({ harness: 'claude', model: 'opus', environmentId: 'node-x' }) })
  await act(async () => { await result.current.library.open(saved) })
  await act(async () => { result.current.composer.changeText('edited on the route') })
  await act(async () => { await result.current.library.park() })
  const staged = lastUpsert(harness.commands, saved.id)?.payload.settings as DraftSessionSettings
  expect(staged.environmentId).toBe('mac')
  expect(staged.harness).toBe('claude')
  expect(staged.model).toBe('opus')
  await unmount()
})

test('an opened desktop draft does not adopt the routed environment', async () => {
  const harness = draftHarness({ harness: 'codex', codexModel: 'saved-model' })
  const { result, unmount } = await harness.render()
  await saveDraft(result, 'desktop draft')
  const saved = [...harness.rows.values()][0]
  expect(saved.settings).not.toHaveProperty('environmentId')
  await act(async () => { result.current.setSettings({ harness: 'codex', codexModel: 'saved-model', environmentId: 'node-x' }) })
  await act(async () => { await result.current.library.open(saved) })
  await act(async () => { result.current.composer.changeText('still the desktop') })
  await act(async () => { await result.current.library.park() })
  const staged = lastUpsert(harness.commands, saved.id)?.payload.settings as DraftSessionSettings
  expect(staged).not.toHaveProperty('environmentId')
  expect(staged.codexModel).toBe('saved-model')
  await unmount()
})

test('a new draft records the phone route', async () => {
  const harness = draftHarness({ harness: 'codex', environmentId: 'node-x' })
  const { result, unmount } = await harness.render()
  await saveDraft(result, 'new on the node')
  const saved = [...harness.rows.values()][0]
  expect(saved.settings.environmentId).toBe('node-x')
  await unmount()
})
