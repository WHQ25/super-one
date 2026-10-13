import { expect, test, type Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const send = (page: Page, value: unknown) => page.evaluate((envelope) => {
  (window as unknown as { __applyHost(value: unknown): void }).__applyHost(envelope)
}, value)

const url = 'https://github.com/wheresryan22/anatomy-of-a-very-long-repository.git'
const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', status: 'complete', createdAt: '2026-10-13T00:00:00Z', content: [{ type: 'text', text: `${url} 看看这个项目` }] },
  { id: 'a1', role: 'assistant', providerId: 'claude', status: 'complete', createdAt: '2026-10-13T00:00:01Z', content: [{ type: 'text', text: `See ${url} for details.` }] },
]

test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
})

// The favicon is an atomic inline, a wrap opportunity of its own. A URL too
// long to fit beside it used to drop to the next line and leave the icon alone
// on the first one.
test('a long URL starts on the favicon line in the user bubble and in markdown', async ({ page }) => {
  await send(page, { type: 'hydrate', messages })
  for (const turn of ['u1', 'a1']) {
    const link = page.locator(`[data-turn-id="${turn}"] a[href="${url}"]`)
    await expect(link).toBeVisible()
    const tops = await link.evaluate((anchor) => {
      const icon = anchor.querySelector('svg, img, span[aria-hidden]')!
      const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode()!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 1)
      const iconBox = icon.getBoundingClientRect()
      const charBox = range.getBoundingClientRect()
      return { icon: iconBox.top + iconBox.height / 2, char: charBox.top, charBottom: charBox.bottom, overflow: anchor.getBoundingClientRect().right > window.innerWidth }
    })
    expect(tops.icon).toBeGreaterThan(tops.char)
    expect(tops.icon).toBeLessThan(tops.charBottom)
    // The URL still wraps rather than overflowing the column.
    expect(tops.overflow).toBe(false)
  }
})
