import { expect, test, type Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const send = (page: Page, value: unknown) => page.evaluate((envelope) => {
  (window as unknown as { __applyHost(value: unknown): void }).__applyHost(envelope)
}, value)
const conversation = (count: number): ChatMessage[] => Array.from({ length: count }, (_, i) => ({
  id: `a${i}`, role: 'assistant' as const, providerId: 'claude', status: 'complete' as const,
  createdAt: '2026-09-08T00:00:00Z',
  content: [{ type: 'text' as const, text: `Answer ${i}\n\n${'A paragraph about the answer. '.repeat(30)}` }],
}))

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
})

// The two washes sit over the live transcript, so the failure that matters is
// not "the gradient is missing" — it is the overlay quietly eating the first and
// last taps of the column. Desktop never hit this: its fades cover a scroll area
// nobody taps. Here the top band lands on a message bubble.
test('the header and composer washes let taps through to the transcript underneath', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(20) })
  await expect(page.locator('[data-turn-id="a19"]')).toBeVisible()

  const fades = page.locator('.chat-view-edge-fade')
  await expect(fades).toHaveCount(2)
  for (const edge of ['top', 'bottom']) {
    const box = await page.locator(`.chat-view-edge-fade[data-edge="${edge}"]`).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBe(16)
  }

  // Whatever the browser reports as hit at the two edges must be transcript
  // content, never the wash.
  const hits = await page.evaluate(() => {
    const midX = window.innerWidth / 2
    const at = (y: number) => document.elementFromPoint(midX, y)?.closest('.chat-view-edge-fade') !== null
    return { top: at(4), bottom: at(window.innerHeight - 4) }
  })
  expect(hits).toEqual({ top: false, bottom: false })
})

// `position: fixed` is what keeps the wash pinned while the body scrolls; a
// regression to `sticky` or `absolute` would scroll it away and only show up as
// an unfaded edge halfway down a long session.
test('the washes stay pinned to the viewport while the transcript scrolls', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(20) })
  await expect(page.locator('[data-turn-id="a19"]')).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 800))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  const top = await page.locator('.chat-view-edge-fade[data-edge="top"]').boundingBox()
  const bottom = await page.locator('.chat-view-edge-fade[data-edge="bottom"]').boundingBox()
  const height = await page.evaluate(() => window.innerHeight)
  expect(top!.y).toBe(0)
  expect(bottom!.y + bottom!.height).toBe(height)
})
