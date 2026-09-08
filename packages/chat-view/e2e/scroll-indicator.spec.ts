import { expect, test, type Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const send = (page: Page, value: unknown) => page.evaluate((envelope) => {
  (window as unknown as { __applyHost(value: unknown): void }).__applyHost(envelope)
}, value)
const message = (id: string, role: ChatMessage['role'], text: string, providerId = 'claude'): ChatMessage => ({
  id, role, content: [{ type: 'text', text }], providerId, status: 'complete', createdAt: '2026-09-08T00:00:00Z',
})
const conversation = (count: number, providerId = 'claude') => Array.from({ length: count }, (_, i) => [
  message(`u${i}`, 'user', `Question ${i}\nMore detail ${i}`, providerId),
  message(`a${i}`, 'assistant', `Answer ${i}\n\n${'A paragraph about the answer. '.repeat(30)}`, providerId),
]).flat()
const tick = (page: Page, id: string) => page.locator(`[data-tick="${id}"]`)
const targetTop = (page: Page, id: string) => page.locator(`[data-turn-id="${id}"]`).evaluate((el) => el.getBoundingClientRect().top)

test.beforeEach(async ({ page, browserName }) => {
  if (browserName === 'webkit') {
    // Playwright WebKit rejects file:// navigation. Fulfil the same offline
    // build at a synthetic origin, with every other request blocked.
    const root = resolve(import.meta.dirname, '../dist')
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
      if (url.origin !== 'https://chat-view.test' || !path.startsWith(`${root}/`)) return route.abort()
      await route.fulfill({ path })
    })
    await page.goto('https://chat-view.test/index.html')
  } else {
    await page.context().setOffline(true)
    await page.goto(documentUrl)
  }
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
})

test('previews the desktop outline in both themes and jumps outside the mounted window', async ({ page }, info) => {
  await send(page, { type: 'hydrate', messages: conversation(100) })
  await expect(page.locator('[data-tick]')).toHaveCount(100)
  await expect(page.locator('[data-turn-id="u4"]')).toHaveCount(0)
  const scrollY = await page.evaluate(() => window.scrollY)
  await tick(page, 'u4').hover()
  await expect(page.getByRole('tooltip')).toContainText('Question 4')
  await expect(page.getByRole('tooltip')).toContainText('More detail 4')
  await expect(page.getByRole('tooltip')).toContainText('Answer 4')
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  for (const scheme of ['light', 'dark']) {
    await send(page, { type: 'setTheme', scheme })
    await page.waitForTimeout(200) // Let tick colour transitions settle before visual QA.
    await page.screenshot({ path: info.outputPath(`outline-${scheme}.png`) })
  }
  await tick(page, 'u4').click()
  await expect.poll(async () => Math.abs(await targetTop(page, 'u4'))).toBeLessThan(16)
  await expect(tick(page, 'u4')).toHaveAttribute('aria-current', 'step')
  expect(await page.locator('[data-turn-id]').count()).toBeLessThanOrEqual(40)
})

test('holds the reading position when a historical turn is open during streaming', async ({ page }) => {
  const messages = conversation(80)
  await send(page, { type: 'hydrate', messages })
  await tick(page, 'u2').click()
  await expect.poll(async () => Math.abs(await targetTop(page, 'u2'))).toBeLessThan(16)
  await page.waitForTimeout(800)
  const before = await targetTop(page, 'u2')
  await send(page, { type: 'applyReductionPatch', messages: [...messages.slice(0, -1), { ...messages.at(-1)!, status: 'streaming',
    content: [{ type: 'text', text: 'New streaming answer '.repeat(200) }] }], sessionStatus: 'streaming' })
  await page.waitForTimeout(300)
  expect(Math.abs(await targetTop(page, 'u2') - before)).toBeLessThan(2)
  await expect(tick(page, 'u2')).toHaveAttribute('aria-current', 'step')
})

test('expands and collapses compacted history and jumps across the boundary', async ({ page }) => {
  const turns = conversation(12)
  turns.splice(12, 0, message('compact', 'assistant', '__compact__:auto:12000', 'system'))
  await send(page, { type: 'hydrate', messages: turns })
  await expect(page.locator('[data-tick]')).toHaveCount(6)
  await expect(page.locator('[data-turn-id="u0"]')).toHaveCount(0)
  const compact = page.locator('[data-compact-tick]')
  await expect(compact).toHaveAttribute('aria-expanded', 'false')
  await compact.click()
  await expect(page.locator('[data-tick]')).toHaveCount(12)
  await tick(page, 'u0').click()
  await expect.poll(async () => Math.abs(await targetTop(page, 'u0'))).toBeLessThan(16)
  await compact.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-tick]')).toHaveCount(6)
  await expect(page.locator('[data-turn-id="u0"]')).toHaveCount(0)
  await send(page, { type: 'scrollToTurn', turnId: 'u1', behavior: 'auto' })
  await expect(page.locator('[data-tick]')).toHaveCount(12)
  await expect.poll(async () => Math.abs(await targetTop(page, 'u1'))).toBeLessThan(16)
})

test('hides a single-turn rail and resets the outline on session replacement', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(12) })
  await expect(page.getByRole('navigation')).toBeVisible()
  await send(page, { type: 'hydrate', messages: conversation(1) })
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await send(page, { type: 'reset' })
  await expect(page.locator('[data-turn-id]')).toHaveCount(0)
})

// The outline keys on role alone, so every harness gets the same rail. Codex is
// the one shape worth pinning: desktop keeps its answer in `metadata.codex` with
// an empty `content`, and only `stripMessagesForRemote` converts it to blocks —
// the rail must stand up either way.
for (const providerId of ['claude', 'codex', 'opencode', 'acp', 'cursor', 'dsh'] as const) {
  test(`renders the same rail for a ${providerId} session`, async ({ page }) => {
    await send(page, { type: 'hydrate', messages: conversation(6, providerId) })
    await expect(page.locator('.chat-scroll-tick')).toHaveCount(6)
    await tick(page, 'u2').focus()
    await expect(page.getByRole('tooltip')).toContainText('Question 2')
    await tick(page, 'u2').click()
    await expect.poll(async () => Math.abs(await targetTop(page, 'u2'))).toBeLessThan(16)
  })
}

test('supports keyboard preview and navigation without moving the transcript on focus', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(12) })
  const before = await page.evaluate(() => window.scrollY)
  await tick(page, 'u3').focus()
  await page.keyboard.press('ArrowDown')
  await expect(tick(page, 'u4')).toBeFocused()
  await expect(page.getByRole('tooltip')).toContainText('Question 4')
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await page.keyboard.press('Enter')
  await expect.poll(async () => Math.abs(await targetTop(page, 'u4'))).toBeLessThan(16)
})

test('touch drag previews under the finger and jumps on release; cancellation does not jump', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(12) })
  const client = await page.context().newCDPSession(page)
  const bounds = await tick(page, 'u3').boundingBox()
  const destination = await tick(page, 'u6').boundingBox()
  const x = bounds!.x + bounds!.width / 2, y = bounds!.y + bounds!.height / 2
  const startY = await page.evaluate(() => window.scrollY)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await expect(page.getByRole('tooltip')).toContainText('Question 3')
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: destination!.y + 4 }] })
  await expect(page.getByRole('tooltip')).toContainText('Question 6')
  expect(await page.evaluate(() => window.scrollY)).toBe(startY)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => Math.abs(await targetTop(page, 'u6'))).toBeLessThan(16)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(tick(page, 'u6')).toHaveAttribute('aria-current', 'step')
})

test('pages beyond forty messages in both directions after a jump', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(100) })
  await send(page, { type: 'scrollToTurn', turnId: 'u50', behavior: 'auto' })
  await page.waitForTimeout(750)
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Load earlier', exact: true }).click()
    await page.waitForTimeout(100)
  }
  expect(Number(await page.locator('main').getAttribute('data-window-start'))).toBeLessThan(76)
  expect(await page.locator('[data-turn-id]').count()).toBeLessThanOrEqual(40)
  const oldEnd = Number(await page.locator('main').getAttribute('data-window-end'))
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Load later', exact: true }).click()
    await page.waitForTimeout(100)
  }
  expect(Number(await page.locator('main').getAttribute('data-window-end'))).toBeGreaterThan(oldEnd)
  expect(await page.locator('[data-turn-id]').count()).toBeLessThanOrEqual(40)
})


test('touch scrubbing scrolls an overflowing tick strip without moving the transcript', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: conversation(200) })
  const strip = page.locator('.chat-scroll-strip')
  await expect(strip).toHaveAttribute('data-overflow', 'true')
  await strip.evaluate((element) => { element.scrollTop = 0 })
  const before = await page.evaluate(() => window.scrollY)
  const client = await page.context().newCDPSession(page)
  const bounds = await strip.boundingBox()
  const point = { x: bounds!.x + 16, y: bounds!.y + bounds!.height - 5 }
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await expect.poll(() => strip.evaluate((element) => element.scrollTop)).toBeGreaterThan(40)
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  expect(await page.locator('[data-turn-id]').count()).toBeLessThanOrEqual(40)
})

test('compact marker rows expand history one boundary at a time', async ({ page }) => {
  const turns = conversation(6)
  turns.splice(8, 0, message('compact2', 'assistant', '__compact__:auto:12000', 'system'))
  turns.splice(4, 0, message('compact1', 'assistant', '__compact__:manual:8000', 'system'))
  await send(page, { type: 'hydrate', messages: turns })
  await expect(page.locator('[data-tick]')).toHaveCount(2)
  await page.locator('[data-turn-id="compact2"]').getByRole('button', { name: 'Show history' }).click()
  await expect(page.locator('[data-tick]')).toHaveCount(4)
  await page.waitForTimeout(750)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator('[data-turn-id="compact1"]')).toHaveCount(1)
  await page.locator('[data-turn-id="compact1"]').getByRole('button', { name: 'Show history' }).click()
  await expect(page.locator('[data-tick]')).toHaveCount(6)
  await page.locator('[data-turn-id="compact2"]').getByRole('button', { name: 'Hide history' }).click()
  await expect(page.locator('[data-tick]')).toHaveCount(2)
})
