// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { LSPClient, type Transport } from '@codemirror/lsp-client'
import { SharedLspWorkspace } from '@/lib/lsp-client-service'
import { createAltHoverTooltipExtension } from './cm-lsp'

function createMockTransport(onRequest: (method: string, params: unknown) => unknown): Transport {
  const handlers = new Set<(value: string) => void>()
  return {
    send(message: string) {
      const parsed = JSON.parse(message) as { id?: number; method?: string; params?: unknown }
      if (parsed.id == null || !parsed.method) return
      let result: unknown = null
      if (parsed.method === 'initialize') {
        result = {
          capabilities: {
            hoverProvider: true,
            definitionProvider: true,
            completionProvider: {},
          },
        }
      } else {
        result = onRequest(parsed.method, parsed.params)
      }
      const reply = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result })
      queueMicrotask(() => {
        for (const h of handlers) h(reply)
      })
    },
    subscribe(handler) {
      handlers.add(handler)
    },
    unsubscribe(handler) {
      handlers.delete(handler)
    },
  }
}

describe('createAltHoverTooltipExtension', () => {
  let view: EditorView | null = null
  let client: LSPClient | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    client?.disconnect()
    client = null
    document.body.innerHTML = ''
  })

  it('requests textDocument/hover only when Alt is pressed while hovering', async () => {
    const requests: string[] = []
    client = new LSPClient({
      rootUri: 'file:///repo',
      workspace: (c) => new SharedLspWorkspace(c, '/repo'),
    })
    client.connect(
      createMockTransport((method) => {
        requests.push(method)
        if (method === 'textDocument/hover') {
          return { contents: { kind: 'markdown', value: '```ts\nconst foo: number\n```' } }
        }
        return null
      }),
    )
    await client.initializing

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const comp = new Compartment()
    view = new EditorView({
      state: EditorState.create({
        doc: 'const foo = 1',
        extensions: [comp.of([])],
      }),
      parent,
    })
    view.posAtCoords = () => 7
    view.dispatch({
      effects: comp.reconfigure([
        client.plugin('file:///repo/a.ts', 'typescript'),
        createAltHoverTooltipExtension(),
      ]),
    })

    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, altKey: false }))
    await new Promise((r) => setTimeout(r, 50))
    expect(requests).not.toContain('textDocument/hover')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))
    await new Promise((r) => setTimeout(r, 50))
    expect(requests).toContain('textDocument/hover')
    expect(view.dom.querySelector('.cm-lsp-hover-tooltip')?.textContent).toContain('const foo: number')
  })
})
