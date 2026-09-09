import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { HostInbound } from '../src/protocol'

/**
 * Whether a widget blends into the transcript, tested against the **built** document.
 *
 * A widget body is transparent, so the frame is supposed to disappear and let the
 * chat background through. Whether it actually does is decided by the compositor,
 * not by any style the DOM will report: an iframe is only composited transparently
 * while its used `color-scheme` matches its parent's, and the moment they differ the
 * engine paints the frame's own opaque canvas underneath so mismatched text cannot
 * land on an unreadable backdrop.
 *
 * That is why this file exists rather than a unit test. Every computed style in the
 * failing case reads `rgba(0, 0, 0, 0)` from the iframe all the way up to the body —
 * and the widget still sat on a white slab. Only pixels tell the truth.
 */
const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const clockStart = new Date('2026-09-09T00:00:00.000Z')

/** Tall, and painting nothing: the frame is almost entirely see-through, or it is not. */
const WIDGET = {
  title: 'transparent_widget',
  widget_code: '<div style="height:220px;font:12px system-ui">only these words</div>',
  width: 800,
  height: 240,
  isSVG: false,
}

function widgetTurn(): ChatMessage {
  return {
    id: 'w',
    role: 'assistant',
    status: 'complete',
    createdAt: clockStart.toISOString(),
    providerId: 'claude',
    content: [
      { type: 'tool_use', toolName: 'mcp__superone__widget_show', toolUseId: 't1', input: '{}', status: 'complete' },
      { type: 'tool_result', toolUseId: 't1', summary: JSON.stringify(WIDGET) },
    ],
  }
}

async function send(page: Page, envelope: HostInbound): Promise<void> {
  await page.evaluate((value) => {
    const target = globalThis as typeof globalThis & { __applyHost?: (message: unknown) => void }
    if (!target.__applyHost) throw new Error('Chat host bridge is unavailable')
    target.__applyHost(value)
  }, envelope)
}

/**
 * A patch of the empty lower half of the widget frame, and a patch of bare transcript
 * the same size. Two uniform fills of one colour encode to identical PNG bytes, so
 * comparing the buffers asserts the paint without decoding anything — and an opaque
 * frame canvas, whatever colour it is, makes them differ.
 */
async function framePatchMatchesTranscript(page: Page): Promise<boolean> {
  const box = await page.locator('iframe').first().boundingBox()
  if (!box) throw new Error('widget frame has no box')
  const patch = { width: 60, height: 24 }
  const insideFrame = await page.screenshot({
    clip: { x: box.x + 12, y: box.y + box.height - 40, ...patch },
  })
  const bareTranscript = await page.screenshot({
    clip: { x: 12, y: 844 - 40, ...patch },
  })
  return Buffer.compare(insideFrame, bareTranscript) === 0
}

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.clock.install({ time: clockStart })
  await page.addInitScript(() => {
    const target = globalThis as typeof globalThis & {
      ReactNativeWebView: { postMessage(message: string): void }
    }
    target.ReactNativeWebView = { postMessage() {} }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000))
  await send(page, { type: 'hydrate', sessionStatus: 'idle', messages: [widgetTurn()] })
  await expect(page.locator('iframe').first()).toBeVisible()
})

test('the widget document adopts the transcript colour scheme', async ({ page }) => {
  const host = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
  expect(frame, 'the widget frame should be attached').toBeTruthy()

  // Parity is the whole mechanism; naming both sides keeps the test honest if the
  // transcript ever stops declaring a scheme of its own.
  expect(host).toBe('dark')
  expect(await frame!.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
})

test('the frame paints the transcript background rather than its own canvas', async ({ page }) => {
  expect(await framePatchMatchesTranscript(page)).toBe(true)
})

test('parity survives a theme change after the frame is already mounted', async ({ page }) => {
  // The srcdoc is built once, so a later switch can only be delivered over the theme
  // bridge — the path that used to carry the palette but not the scheme.
  await send(page, { type: 'setTheme', scheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!
  await expect
    .poll(() => frame.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe('light')
  expect(await framePatchMatchesTranscript(page)).toBe(true)
})
