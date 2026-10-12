import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'

const url = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const budget = { ...DEFAULT_WINDOW_BUDGET, maxBytes: 48 * 1024, targetChars: 2500 }

const replies = {
  prose: () => Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: ${'the reply keeps explaining. '.repeat(8)}`).join('\n\n'),
  fence: () => `Module:\n\n\`\`\`ts\n${Array.from({ length: 900 }, (_, i) => `export const value${i} = ${i}`).join('\n')}\n\`\`\``,
  table: () => `| Case | Result |\n| --- | --- |\n${Array.from({ length: 900 }, (_, i) => `| case ${i} | pass |`).join('\n')}`,
}

/** A partial reply as native would hold it, and the page its earlier part arrives as. */
function fixture(kind: keyof typeof replies = 'prose') {
  const transcript = [textMessage('ask', 'user', 'Explain everything'), textMessage('reply', 'assistant', replies[kind]())]
  const source = windowSource(transcript)
  const tail = applyWindowResult(null, { ...selectTranscriptWindow(source, {}, budget), total: 2 }, EMPTY_WINDOW_LOOKUP).state
  const grown = applyWindowResult(tail, { ...selectTranscriptWindow(source, { anchor: tail.older!, direction: 'before' }, budget), total: 2 }, EMPTY_WINDOW_LOOKUP, 'older').state
  return {
    tail: tail.messages.map(materializeWindowMessage),
    page: { messages: grown.messages.map(materializeWindowMessage), messageOrder: grown.messages.map((m) => m.id), replace: false,
      hasMoreHistory: grown.older !== null, hasNewerHistory: false },
    full: transcript[1],
  }
}

async function open(page: Page, kind: keyof typeof replies = 'prose') {
  const data = fixture(kind)
  await page.context().setOffline(true)
  await page.addInitScript((data) => {
    const host = window as any
    host.calls = []
    host.copied = []
    host.ReactNativeWebView = { postMessage(raw: string) {
      const request = JSON.parse(raw)
      if (request.type !== 'requestNative') return
      host.calls.push(request.action)
      const reply = (result: unknown) => queueMicrotask(() => host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId, result }))
      if (request.action === 'loadEarlier') reply(data.page)
      else if (request.action === 'loadFullMessage') reply({ message: data.full })
      else if (request.action === 'copyText') { host.copied.push(request.payload.text); reply({}) }
      else reply({})
    } }
  }, data)
  await page.goto(url)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate(() => (window as any).__applyHost({ type: 'channelToken', token: 'playwright-window' }))
  await page.evaluate((tail) => (window as any).__applyHost({ type: 'hydrate', transcriptWindow: true, hasMoreHistory: true, sessionStatus: 'idle', messages: tail }), data.tail)
  return data
}

test('shows the tail of a partial reply and marks its earlier part', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-testid="window-earlier-part"]')).toHaveCount(1)
  await expect(page.locator('[data-turn-id="reply"]')).toContainText('Paragraph 399')
  await expect(page.locator('[data-turn-id="reply"]')).not.toContainText('Paragraph 0:')
  await page.screenshot({ path: test.info().outputPath('partial-reply.png') })
  await page.locator('[data-testid="window-earlier-part"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('partial-reply-top.png') })
})

test('loads the earlier part into the same message without moving what is on screen', async ({ page }) => {
  await open(page)
  const marker = page.locator('[data-turn-id="reply"] p', { hasText: 'Paragraph 399' })
  await marker.scrollIntoViewIfNeeded()
  const before = await marker.evaluate((element) => element.getBoundingClientRect().top)
  await page.locator('[data-testid="edge-loader-top"]').evaluate((element: HTMLElement) => element.click())
  await expect.poll(() => page.evaluate(() => (window as any).calls.includes('loadEarlier'))).toBe(true)
  await expect(page.locator('[data-turn-id="reply"]')).toHaveCount(1)
  const after = await marker.evaluate((element) => element.getBoundingClientRect().top)
  expect(Math.abs(after - before)).toBeLessThan(4)
})

test('copies the whole reply, not the part on screen', async ({ page }) => {
  const data = await open(page)
  await page.locator('[data-turn-id="reply"]').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Copy' }).last().click()
  await expect.poll(() => page.evaluate(() => (window as any).copied.length)).toBe(1)
  const copied = await page.evaluate(() => (window as any).copied[0] as string)
  expect(copied).toBe((data.full.content[0] as { text: string }).text.trim())
})

test('renders a slice that starts inside a code fence as code', async ({ page }) => {
  await open(page, 'fence')
  const reply = page.locator('[data-turn-id="reply"]')
  await expect(reply.locator('pre')).toHaveCount(1)
  await expect(reply.locator('pre')).toContainText('export const value899 = 899')
  await expect(reply).not.toContainText('```')
})

test('repeats the header rows of a table a slice starts inside', async ({ page }) => {
  await open(page, 'table')
  const table = page.locator('[data-turn-id="reply"] table').first()
  await expect(table.locator('th').first()).toHaveText('Case')
  await expect(table).toContainText('case 899')
})
