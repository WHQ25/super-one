/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { installHostBridge } from '@superone/chat-view/bridge'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'

/**
 * Fake native host for the phone's files previewer: records every request the
 * WebView sends and answers `loadTextFile` / `loadImage` from fixtures, the way
 * the RN layer relays the desktop's `read_desktop_file`.
 */
type Sent = { action: string; payload?: Record<string, unknown> }
let sent: Sent[] = []
let dispose: (() => void) | null = null

function installFakeHost(texts: Record<string, string>): void {
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
      if (message.action === 'loadTextFile') {
        const text = texts[String(message.payload?.path)]
        reply(text === undefined ? { result: { ok: true, tooLarge: true } } : { result: { ok: true, text } })
      } else if (message.action === 'loadImage') {
        reply({ result: { ok: true, dataUri: 'data:image/png;base64,AA==' } })
      } else {
        reply({ result: { ok: true } })
      }
    },
  }
  dispose = () => { unhook(); delete browser.ReactNativeWebView }
}

beforeEach(() => { sent = [] })
afterEach(() => { dispose?.(); dispose = null })

const ROOT = '/repo'
const image: PreviewerFile = { path: 'shot.png', absolutePath: `${ROOT}/shot.png`, name: 'shot.png', kind: 'image', size: 1200, note: 'The drawer, open' }
const text: PreviewerFile = { path: 'src/a.ts', absolutePath: `${ROOT}/src/a.ts`, name: 'a.ts', kind: 'text', size: 40, note: 'Entry point' }
const pdf: PreviewerFile = { path: 'report.pdf', absolutePath: `${ROOT}/report.pdf`, name: 'report.pdf', kind: 'pdf', size: 51200 }
const missing: PreviewerFile = { path: 'gone.md', absolutePath: `${ROOT}/gone.md`, name: 'gone.md', kind: 'missing' }

function payload(files: PreviewerFile[]): string {
  return JSON.stringify({ kind: 'native', nativeType: 'files-previewer', title: 'evidence', root: ROOT, files })
}

function renderRow(result: string) {
  return render(
    <PortableToolRow toolName="mcp__superone__widget_show" toolUseId="w-1" input="{}" status="complete" result={result} />,
  )
}

const card = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-native-widget="files-previewer"]')!
const stage = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-previewer-stage]')!

function swipe(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: from, clientY: 50, pointerType: 'touch', button: 0 })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: (from + to) / 2, clientY: 52 })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to, clientY: 54 })
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to, clientY: 54 })
  fireEvent.click(el)
}

describe('files previewer on the phone', () => {
  it('replaces the widget_show row with the card and keeps a gallery payload on the gallery', () => {
    installFakeHost({})
    const { container } = renderRow(payload([pdf]))
    expect(card(container)).not.toBeNull()
    expect(container.textContent).not.toContain('widget show')
    expect(container.querySelector('[data-previewer-chip="default"]')?.textContent).toContain('report.pdf')

    const gallery = JSON.stringify({
      kind: 'native', nativeType: 'image-gallery', title: 'g',
      images: [{ id: 'g-0', type: 'image_generation', status: 'completed', savedPath: '/tmp/a.png' }],
    })
    expect(renderRow(gallery).container.querySelector('[data-native-widget="image-gallery"]')).not.toBeNull()
  })

  it('renders small text in place through loadTextFile and shows the note under it', async () => {
    installFakeHost({ [`${ROOT}/src/a.ts`]: 'export const answer = 42\n' })
    const { container } = renderRow(payload([text]))
    await waitFor(() => expect(container.querySelector('[data-previewer-text="ready"]')).not.toBeNull())
    expect(container.textContent).toContain('answer')
    expect(container.querySelector('[data-previewer-note]')?.textContent).toBe('Entry point')
    expect(sent.map((s) => s.action)).toEqual(['loadTextFile'])
  })

  it('falls back to a chip when the host will not inline the text', async () => {
    installFakeHost({})
    const { container } = renderRow(payload([{ ...text, absolutePath: `${ROOT}/src/big.ts`, name: 'big.ts' }]))
    await waitFor(() => expect(container.querySelector('[data-previewer-chip="default"]')).not.toBeNull())
    expect(container.textContent).toContain('Tap to open')
  })

  it('swipes between files with no arrows, and a swipe never opens the file', async () => {
    installFakeHost({})
    const { container } = renderRow(payload([pdf, missing, image]))
    expect(container.querySelector('button[aria-label="Next file"]')).toBeNull()
    expect(card(container).dataset.index).toBe('0')

    await act(async () => { swipe(stage(container), 200, 100) })
    expect(card(container).dataset.index).toBe('1')
    expect(container.querySelector('[data-previewer-chip="error"]')?.textContent).toContain('gone.md')
    expect(sent.some((s) => s.action === 'previewFile')).toBe(false)

    // A short horizontal drag backs out; a vertical one belongs to the scroller.
    await act(async () => { swipe(stage(container), 100, 120) })
    expect(card(container).dataset.index).toBe('1')
    await act(async () => { swipe(stage(container), 100, 300) })
    expect(card(container).dataset.index).toBe('0')
  })

  it('opens the current file in the native preview on a plain tap, but never a missing one', async () => {
    installFakeHost({})
    const { container } = renderRow(payload([pdf, missing]))
    await act(async () => { fireEvent.click(stage(container)) })
    expect(sent.filter((s) => s.action === 'previewFile').map((s) => s.payload)).toEqual([{ path: `${ROOT}/report.pdf` }])

    await act(async () => { fireEvent.click(container.querySelector('[data-previewer-dots] button[aria-label="2"]')!) })
    expect(card(container).dataset.index).toBe('1')
    await act(async () => { fireEvent.click(stage(container)) })
    expect(sent.filter((s) => s.action === 'previewFile')).toHaveLength(1)
  })

  it('lets the host image keep its own tap once the picture is in, so a loaded image opens without a second transfer', async () => {
    installFakeHost({})
    const { container } = renderRow(payload([image]))
    await waitFor(() => expect(container.querySelector('[data-host-image="ready"]')).not.toBeNull())
    await act(async () => { fireEvent.click(container.querySelector('[data-host-image="ready"]')!) })
    const actions = sent.map((s) => s.action)
    expect(actions).toContain('previewImage')
    expect(actions).not.toContain('previewFile')
  })
})
