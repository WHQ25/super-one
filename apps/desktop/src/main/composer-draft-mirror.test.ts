import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: {
  on: (channel: string, callback: (...args: unknown[]) => unknown) => handlers.set(channel, callback),
  handle: (channel: string, callback: (...args: unknown[]) => unknown) => handlers.set(channel, callback),
} }))
import { installComposerDraftMirror } from './composer-draft-mirror'

afterEach(() => { handlers.clear() })
const windowFor = (id: number) => ({ isDestroyed: () => false, webContents: { id, send: vi.fn() } })

describe('composer draft mirror', () => {
  it('relays an edit to every other window and merges it for windows that open later', () => {
    const main = windowFor(1), mini = windowFor(2)
    const mirror = installComposerDraftMirror(new Set([main, mini]) as unknown as Set<BrowserWindow>)
    const publish = handlers.get(AgentIpcChannels.COMPOSER_DRAFT_PUBLISH)!
    const snapshot = () => handlers.get(AgentIpcChannels.COMPOSER_DRAFTS_GET)!()

    publish({ sender: { id: 1 } }, 's1', { draftText: 'hi', browserAnnotations: [{ id: 'a' }] })
    publish({ sender: { id: 2 } }, 's1', { draftText: 'hi there' })

    expect(main.webContents.send.mock.calls).toEqual([[AgentIpcChannels.COMPOSER_DRAFT_CHANGED, 's1', { draftText: 'hi there' }]])
    expect(mini.webContents.send.mock.calls).toEqual([[AgentIpcChannels.COMPOSER_DRAFT_CHANGED, 's1', { draftText: 'hi', browserAnnotations: [{ id: 'a' }] }]])
    expect(snapshot()).toEqual({ s1: { draftText: 'hi there', browserAnnotations: [{ id: 'a' }] } })

    mirror.forget(['s1'])
    expect(snapshot()).toEqual({})
  })
})
