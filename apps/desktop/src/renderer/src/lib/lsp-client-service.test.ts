/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disposeLspClient,
  getLspClientStatus,
  getOrCreateLspClientEntry,
  pickBestDefinitionLocation,
} from './lsp-client-service'

describe('pickBestDefinitionLocation', () => {
  it('prefers cross-file definition when server returns local import and external definition', () => {
    const result = [
      {
        uri: 'file:///repo/src/a.ts',
        range: { start: { line: 2, character: 9 }, end: { line: 2, character: 12 } },
      },
      {
        uri: 'file:///repo/src/b.ts',
        range: { start: { line: 10, character: 16 }, end: { line: 10, character: 19 } },
      },
    ]

    expect(pickBestDefinitionLocation(result, 'file:///repo/src/a.ts')).toEqual({
      uri: 'file:///repo/src/b.ts',
      range: { start: { line: 10, character: 16 } },
    })
  })

  it('supports LocationLink items and single-location fallback', () => {
    const linkResult = [
      {
        targetUri: 'file:///repo/src/a.ts',
        targetSelectionRange: { start: { line: 1, character: 2 } },
      },
      {
        targetUri: 'file:///repo/src/target.ts',
        targetSelectionRange: { start: { line: 4, character: 7 } },
      },
    ]

    expect(pickBestDefinitionLocation(linkResult, 'file:///repo/src/a.ts')).toEqual({
      uri: 'file:///repo/src/target.ts',
      range: { start: { line: 4, character: 7 } },
    })

    expect(
      pickBestDefinitionLocation(
        { uri: 'file:///repo/src/a.ts', range: { start: { line: 1, character: 2 } } },
        'file:///repo/src/a.ts',
      ),
    ).toEqual({
      uri: 'file:///repo/src/a.ts',
      range: { start: { line: 1, character: 2 } },
    })
  })
})

describe('getOrCreateLspClientEntry workDoneProgress and root normalization', () => {
  afterEach(() => {
    disposeLspClient('typescript', '/repo')
    vi.restoreAllMocks()
  })

  it('tracks starting -> indexing -> ready via workDoneProgress and normalizes trailing slashes', async () => {
    type LspMessageHandler = (payload: { serverId: string; workspaceRoot: string; message: string }) => void
    let listener: LspMessageHandler | null = null
    const emit = (payload: { serverId: string; workspaceRoot: string; message: string }) => {
      listener?.(payload)
    }
    const sentMessages: string[] = []

    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      onLspMessage: (cb: LspMessageHandler) => {
        listener = cb
        return () => {
          listener = null
        }
      },
      sendLspMessage: vi.fn(async (_serverId: string, _root: string, message: string) => {
        sentMessages.push(message)
        const parsed = JSON.parse(message) as { id?: number; method?: string }
        if (parsed.method === 'initialize' && parsed.id != null) {
          queueMicrotask(() => {
            emit({
              serverId: 'typescript',
              workspaceRoot: '/repo',
              message: JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                result: { capabilities: { definitionProvider: true } },
              }),
            })
          })
        }
      }),
    }

    const entryA = getOrCreateLspClientEntry('typescript', '/repo/')
    const entryB = getOrCreateLspClientEntry('typescript', '/repo')
    expect(entryA).toBe(entryB)
    expect(getLspClientStatus('typescript', '/repo')?.phase).toBe('starting')

    await entryA.client.initializing
    expect(getLspClientStatus('typescript', '/repo')?.phase).toBe('ready')

    emit({
      serverId: 'typescript',
      workspaceRoot: '/repo',
      message: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'window/workDoneProgress/create',
        params: { token: 'tok-1' },
      }),
    })
    expect(
      sentMessages.some((msg) => {
        const parsed = JSON.parse(msg) as { id?: number; result?: unknown }
        return parsed.id === 99 && parsed.result === null
      }),
    ).toBe(true)

    emit({
      serverId: 'typescript',
      workspaceRoot: '/repo',
      message: JSON.stringify({
        jsonrpc: '2.0',
        method: '$/progress',
        params: { token: 'tok-1', value: { kind: 'begin', title: 'Indexing' } },
      }),
    })
    expect(getLspClientStatus('typescript', '/repo')?.phase).toBe('indexing')

    emit({
      serverId: 'typescript',
      workspaceRoot: '/repo',
      message: JSON.stringify({
        jsonrpc: '2.0',
        method: '$/progress',
        params: { token: 'tok-1', value: { kind: 'end' } },
      }),
    })
    expect(getLspClientStatus('typescript', '/repo')?.phase).toBe('ready')
  })
})
