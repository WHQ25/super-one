/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortableHostImage } from '@superone/chat-view/PortableHostImage'
import { installHostBridge } from '@superone/chat-view/bridge'

/**
 * A host image in a remote session: whichever way the row is tapped, the
 * `previewFile` it sends carries the session root, or the phone would open
 * a desktop file of the same path (session-sync-zone.md §4.2).
 */
type Sent = { action: string; payload?: Record<string, unknown> }
let sent: Sent[] = []
let dispose: (() => void) | null = null

function installFakeHost(): void {
  const browser = globalThis as unknown as Window & {
    ReactNativeWebView?: { postMessage(message: string): void }
    __applyHost?: (message: unknown) => void
  }
  const unhook = installHostBridge(() => undefined)
  browser.ReactNativeWebView = {
    postMessage(raw: string) {
      const message = JSON.parse(raw) as { type: string; requestId: string; action: string; payload?: Record<string, unknown> }
      if (message.type !== 'requestNative') return
      sent.push({ action: message.action, payload: message.payload })
      const reply = (body: Record<string, unknown>) => queueMicrotask(() =>
        browser.__applyHost?.({ type: 'nativeActionResult', requestId: message.requestId, ...body }))
      // The host cannot paint this one: the row falls back to its chip.
      reply(message.action === 'loadImage' ? { error: 'loadImage is not available' } : { result: { ok: true } })
    },
  }
  dispose = () => { unhook(); delete browser.ReactNativeWebView }
}

beforeEach(() => { sent = []; installFakeHost() })
afterEach(() => { dispose?.(); dispose = null })

const ROOT = 'remote:conn-1:/home/node/proj'
const PATH = '/home/node/.superone/node/sync/s1/browser/shot.png'

describe('host image in a remote session', () => {
  it('sends the session root with previewFile from the fallback chip too', async () => {
    const { container } = render(<PortableHostImage path={PATH} root={ROOT} label="Screenshot" />)
    await waitFor(() => expect(container.querySelector('[data-host-image="fallback"]')).not.toBeNull())
    await act(async () => { fireEvent.click(container.querySelector('button')!) })
    const preview = sent.filter((s) => s.action === 'previewFile')
    expect(preview.map((s) => s.payload)).toEqual([{ path: PATH, root: ROOT }])
  })
})
