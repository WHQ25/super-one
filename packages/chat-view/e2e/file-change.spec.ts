import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = Array.from({ length: 60 }, (_, i) =>
  `export const entry${String(i).padStart(2, '0')}: string = "${'long value '.repeat(12)}"`,
).join('\n')

async function openFileChange(page: Page, deferred = true, scheme: 'light' | 'dark' = 'dark', kind = 'add') {
  const diff = kind === 'update' ? '@@ -1 +1 @@\n-const enabled = false\n+const enabled = true' : source
  const item = { id: 'patch', type: 'file_change', status: 'completed', changes: [{ path: '/repo/example.ts', kind, diff }] }
  await page.addInitScript((item) => {
    const host = window as unknown as { ReactNativeWebView: { postMessage(raw: string): void }; __applyHost(value: unknown): void }
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail') return
      host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId, result: {
        subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0, text: JSON.stringify({ item }),
      } })
    } }
  }, item)
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate(({ item, deferred, scheme }) => {
    const host = window as unknown as { __applyHost(value: unknown): void }
    host.__applyHost({ type: 'channelToken', token: 'file-change-test' })
    host.__applyHost({ type: 'setTheme', scheme })
    host.__applyHost({ type: 'hydrate', sessionStatus: 'idle', messages: [{
      id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: [deferred
        ? { ...item, remoteDetail: '["turn","item","patch"]', changes: item.changes.map(({ path, kind }) => ({ path, kind, toolLineDelta: { added: 60, removed: 0 } })) }
        : item] } },
    }] })
  }, { item, deferred, scheme })
  const row = page.locator('[data-tool-use-id="patch-0"]')
  await row.getByText('File Change', { exact: true }).click()
  await expect(row).toContainText(kind === 'update' ? 'const enabled = true' : 'entry00')
  return row
}

for (const deferred of [true, false]) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`highlights Codex source without host tokens (${deferred ? 'deferred' : 'full'}, ${scheme})`, async ({ page }) => {
      const row = await openFileChange(page, deferred, scheme)
      // The source text must contain multiple syntax colours, beyond gutter/marker colours.
      const colors = await row.locator('div.whitespace-pre').filter({ hasText: 'entry00' }).evaluate((node) =>
        [...node.querySelectorAll('span[style]')].map(span => getComputedStyle(span).color),
      )
      expect(new Set(colors).size).toBeGreaterThan(1)
      if (deferred && scheme === 'dark') await row.screenshot({ path: '/tmp/superone-file-change-fixed.png' })
    })
  }
}

test('scrolling code vertically keeps its line number aligned and horizontally keeps the gutter visible', async ({ page }) => {
  const row = await openFileChange(page)
  const code = row.locator('div.whitespace-pre').filter({ hasText: 'entry00' })
  const number = row.getByText('1', { exact: true })
  const originalX = (await number.boundingBox())!.x
  const scrolled = await code.evaluate((node) => {
    let scroll = node.parentElement!
    while (scroll.parentElement && !/auto|scroll/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement
    scroll.scrollTop = 120
    scroll.scrollLeft = 160
    return { top: scroll.scrollTop, left: scroll.scrollLeft, height: scroll.clientHeight }
  })
  expect(scrolled.top).toBe(120)
  expect(scrolled.left).toBe(160)
  expect(scrolled.height).toBeLessThanOrEqual(300)
  const codeBox = (await code.boundingBox())!
  const numberBox = (await number.boundingBox())!
  expect(Math.abs(codeBox.y - numberBox.y)).toBeLessThan(1)
  expect(Math.abs(numberBox.x - originalX)).toBeLessThan(1)
})

test('highlights both sides of an update and shows add/delete markers for raw file contents', async ({ page }) => {
  for (const kind of ['update', 'add', 'delete']) {
    const row = await openFileChange(page, true, 'dark', kind)
    const code = row.locator('div.whitespace-pre').filter({ hasText: kind === 'update' ? 'const enabled = true' : 'entry00' })
    await expect(code).toContainText(kind === 'delete' ? '-' : '+')
    expect(await code.locator('span[style]').count()).toBeGreaterThan(1)
    if (kind === 'update') {
      expect(await row.locator('div.whitespace-pre').filter({ hasText: 'const enabled = false' }).locator('span[style]').count()).toBeGreaterThan(1)
    }
  }
})
