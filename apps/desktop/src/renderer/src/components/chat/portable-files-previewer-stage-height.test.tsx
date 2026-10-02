/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { installFakeNativeHost } from '@superone/chat-view/fixtures/native-host'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'

/** The card is 390px wide, the phone's common viewport. */
const CARD_WIDTH = 390
/** A 640×400 image: 244px tall at the card width. */
const WIDE_IMAGE = 'data:image/png;base64,d2lkZQ=='

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(url: string) {
    queueMicrotask(() => {
      if (url !== WIDE_IMAGE) { this.onerror?.(); return }
      this.naturalWidth = 640
      this.naturalHeight = 400
      this.onload?.()
    })
  }
}

class FixedWidthObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    this.callback([{ contentRect: { width: CARD_WIDTH } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve(): void {}
  disconnect(): void {}
}

let dispose: (() => void) | null = null

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('ResizeObserver', FixedWidthObserver)
  dispose = installFakeNativeHost((message, send) => {
    const reply: typeof send = (body) => queueMicrotask(() => send(body))
    const path = String(message.payload?.path)
    if (message.action === 'loadImage') {
      reply(path.includes('relay')
        ? { result: { ok: true, confirmRequired: true, size: 412_000 } }
        : { result: { ok: true, dataUri: WIDE_IMAGE } })
    } else if (message.action === 'loadTextFile') {
      reply({ result: { ok: true, text: 'export const a = 1' } })
    } else {
      reply({ result: { ok: true } })
    }
  })
})
afterEach(() => { dispose?.(); dispose = null; vi.unstubAllGlobals() })

// Unique paths per test: the WebView's byte caches are module-level.
let seq = 0
const file = (kind: PreviewerFile['kind'], name: string): PreviewerFile => {
  const absolutePath = `/repo/${++seq}-${name}`
  return { path: name, absolutePath, name, kind, size: 40 }
}

function stageHeight(files: PreviewerFile[]): () => string {
  const result = JSON.stringify({ kind: 'native', nativeType: 'files-previewer', title: 'evidence', root: '/repo', files })
  const { container } = render(
    <PortableToolRow toolName="mcp__superone__widget_show" toolUseId="w-1" input="{}" status="complete" result={result} />,
  )
  return () => container.querySelector<HTMLElement>('[data-previewer-stage]')!.style.height
}

describe('phone files previewer stage height', () => {
  it('fits the tallest media slide at the card width', async () => {
    const height = stageHeight([file('image', 'shot.png'), file('missing', 'gone.md'), file('pdf', 'q3.pdf')])
    expect(height()).toBe('320px')
    await waitFor(() => expect(height()).toBe('244px'))
  })

  it('drops to the floor when every slide is a chip', async () => {
    const height = stageHeight([file('pdf', 'q3.pdf'), file('missing', 'gone.md')])
    await waitFor(() => expect(height()).toBe('120px'))
  })

  it('keeps the full stage for inline text and for an image waiting on a Load tap', async () => {
    const withText = stageHeight([file('image', 'shot.png'), file('text', 'a.ts')])
    const withRelay = stageHeight([file('image', 'relay.png')])
    await new Promise((r) => setTimeout(r, 20))
    expect(withText()).toBe('320px')
    expect(withRelay()).toBe('320px')
  })
})
