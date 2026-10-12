import { expect, test, type Page } from '@playwright/test'

// Start the desktop Storybook first; the fixture uses real chat stores/renderers.
const base = process.env.SUPERONE_STORYBOOK_URL ?? 'http://localhost:6107'
const viewport = '[data-radix-scroll-area-viewport]'
async function open(page: Page, story: string) {
  await page.goto(`${base}/iframe.html?id=chat-transcript-performance--${story}&viewMode=story&globals=theme:dark`)
  await page.locator('[data-message-id]').first().waitFor()
  await page.waitForTimeout(600)
}
const bottomDistance = (page: Page) => page.locator(viewport).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
async function jump(page: Page, id: string, atEnd = false) {
  await page.locator(`[data-tick="${id}"]`).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.locator(`[data-message-id="${id}"]`)).toBeVisible()
  await expect.poll(() => page.locator(`[data-message-id="${id}"]`).evaluate(el => {
    const viewport = el.closest('[data-radix-scroll-area-viewport]')!
    return Math.abs(el.getBoundingClientRect().top - viewport.getBoundingClientRect().top)
  })).toBeLessThan(atEnd ? 427 : 30)
}

test('bounds mounted history during distant jumps and keeps panel resizing pinned at the bottom', async ({ page }) => {
  await open(page, 'many-turns')
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
  await jump(page, 'perf-1000')
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)

  await open(page, 'long-history')
  await page.locator('[data-perf-toggle]').click()
  await expect.poll(() => page.locator('[data-perf-chat]').evaluate(el => el.clientWidth)).toBeLessThan(410)
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(12)
})

test('bounds a single huge reply, reveals both ends and preserves an active selection', async ({ page }) => {
  await open(page, 'huge-reply')
  await expect(page.getByText(/^Paragraph 359:/)).toBeVisible()
  expect(await page.locator('[data-virtual-markdown-block] p').count()).toBeLessThan(30)
  const selected = await page.locator('[data-virtual-markdown-block] p').last().evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  await page.waitForTimeout(100)
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.getByText(/^Paragraph 0:/)).toBeVisible()
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(selected)
  await page.evaluate(() => document.getSelection()?.removeAllRanges())
  await expect(page.getByText(/^Paragraph 359:/)).toHaveCount(0)
  expect(await page.locator('[data-virtual-markdown-block] p').count()).toBeLessThan(30)
})

test('retains a selected message outside the virtual range until selection is cleared', async ({ page }) => {
  await open(page, 'short-history')
  const selected = await page.locator('[data-message-id="perf-119"] .chat-md p').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  await page.waitForTimeout(100)
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(selected)
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
  await page.evaluate(() => document.getSelection()?.removeAllRanges())
  await expect(page.locator('[data-message-id="perf-119"]')).toHaveCount(0)
})

test('keeps tool disclosure state after eviction and remount', async ({ page }) => {
  await open(page, 'stateful-tools')
  const tool = page.locator('[data-tool-use-id="bash-perf-119"]')
  await tool.locator(':scope > div').first().click()
  await expect(tool.getByText('output-perf-119', { exact: true })).toBeVisible()
  await jump(page, 'perf-0')
  await expect(tool).toHaveCount(0)
  await jump(page, 'perf-118', true)
  await expect(tool.getByText('output-perf-119', { exact: true })).toBeVisible()
})

test('follows streaming at the bottom and holds history when following is paused', async ({ page }) => {
  await open(page, 'long-history')
  for (let index = 0; index < 3; index++) {
    await page.locator('[data-perf-append-chunk]').click()
    await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  }
  await jump(page, 'perf-60')
  const before = await page.locator('[data-message-id="perf-60"]').evaluate(el => el.getBoundingClientRect().top)
  for (let index = 0; index < 3; index++) await page.locator('[data-perf-append-chunk]').click()
  await page.waitForTimeout(400)
  const after = await page.locator('[data-message-id="perf-60"]').evaluate(el => el.getBoundingClientRect().top)
  expect(Math.abs(after - before)).toBeLessThan(3)
  expect(await bottomDistance(page)).toBeGreaterThan(1000)
})

test('expands compacted history for a cross-view jump without mounting the full suffix', async ({ page }) => {
  await open(page, 'compacted-history')
  expect(await page.locator('[data-message-id="perf-0"]').count()).toBe(0)
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
})

test('preserves reference definitions and semantic markdown around virtual block boundaries', async ({ page }) => {
  await open(page, 'semantic-markdown')
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.getByRole('heading', { name: 'Semantic markdown' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reference link' })).toHaveAttribute('href', 'https://example.com/docs')
  await expect(page.locator('li li')).toContainText('Nested child')
  await expect(page.locator('.chat-md table')).toContainText('Alpha')
  await expect(page.locator('.chat-md pre')).toContainText('const answer = 42')
  await expect(page.locator('.katex')).toBeVisible()
})

test('bounds a thousand Codex activities while Detail expands and the panel opens', async ({ page }) => {
  await open(page, 'codex-long-turn')
  const detail = page.locator('.turn-detail-section button')
  await detail.evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByText('echo activity-799', { exact: true })).toBeVisible()
  expect(await page.locator('.tool-node').count()).toBeLessThan(40)
  expect(await page.locator('[data-chat-root] *').count()).toBeLessThan(4500)
  await page.locator('[data-perf-toggle]').click()
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  await expect(page.getByText('echo activity-799', { exact: true })).toBeVisible()
  expect(await page.locator('.tool-node').count()).toBeLessThan(40)

  // A nested tool's open state survives leaving the segment range.
  const last = page.locator('[data-virtual-block]').filter({ hasText: 'echo activity-799' })
  await last.locator('.tool-node').filter({ hasText: 'echo activity-799' }).locator(':scope > div').first().click()
  await expect(last.locator('.text-terminal-muted')).toBeVisible()
  await expect(last.locator('.text-terminal-muted')).toContainText('output-activity-799')
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.getByText('echo activity-0', { exact: true })).toBeVisible()
  await expect(last).toHaveCount(0)
  await page.locator(viewport).evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(last.locator('.text-terminal-muted')).toBeVisible()
  await expect(last.locator('.text-terminal-muted')).toContainText('output-activity-799')
  expect(await page.locator('.tool-node').count()).toBeLessThan(40)
})

async function openContentBlockTurn(page: Page, story = 'streaming', globals = 'theme:dark;locale:zh') {
  await page.goto(`${base}/iframe.html?id=chat-contentblock-turn-performance--${story}&viewMode=story&globals=${globals}`)
  await page.getByText('Latest reply in the long-running turn.').waitFor()
  await expect.poll(() => page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
}

test('bounds a live ContentBlock turn during file-chip opens and restores evicted tools', async ({ page }) => {
  await openContentBlockTurn(page)
  const last = page.locator('[data-tool-use-id="command-611"]')
  await last.locator(':scope > div').first().click()
  await expect(last.getByText('output-activity-611', { exact: true })).toBeVisible()
  await page.locator('[data-perf-file-chip] [role="button"]').click()
  await expect.poll(() => page.locator('[data-activity-outer]').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(399)
  await expect(page.getByRole('tabpanel', { name: 'preview.txt' })).toContainText('File preview is ready.')
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
  expect(await page.locator('[data-chat-root] *').count()).toBeLessThan(4000)
  await page.locator('[data-perf-append-chunk]').click()
  await expect(page.getByText('Newest streamed update.')).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThan(3)

  const selected = await page.getByText('Newest streamed update.').evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.locator('[data-tool-use-id="command-0"]')).toBeVisible()
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(selected)
  await page.evaluate(() => document.getSelection()?.removeAllRanges())
  await expect(last).toHaveCount(0)
  const before = await page.locator('[data-tool-use-id="command-0"]').evaluate(el => el.getBoundingClientRect().top)
  await page.locator('[data-perf-append-chunk]').click()
  await page.waitForTimeout(200)
  const after = await page.locator('[data-tool-use-id="command-0"]').evaluate(el => el.getBoundingClientRect().top)
  expect(Math.abs(after - before)).toBeLessThan(3)
  await page.locator(viewport).evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(last.getByText('output-activity-611', { exact: true })).toBeVisible()
})

test('keeps completed ContentBlock details and narrow streaming turns bounded', async ({ page }) => {
  await openContentBlockTurn(page, 'completed-details', 'theme:light;locale:en')
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.locator('[data-tool-use-id="command-0"]')).toBeVisible()
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
  await openContentBlockTurn(page, 'narrow')
  await page.locator('[data-perf-file-chip] [role="button"]').click()
  await expect.poll(() => page.locator('[data-perf-chat]').evaluate(el => el.clientWidth)).toBeLessThan(250)
  await expect(page.getByText('Latest reply in the long-running turn.')).toBeVisible()
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
})
