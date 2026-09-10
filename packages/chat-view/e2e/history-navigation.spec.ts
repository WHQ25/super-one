import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const url = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href

async function open(page: Page, opts: { failWindow?: boolean; holdWindow?: boolean; holdIndex?: boolean; compacts?: boolean } = {}) {
  await page.context().setOffline(true)
  await page.addInitScript((opts) => {
    const host = window as any
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user',
      status: 'complete', providerId: 'claude', createdAt: '', content: [{ type: 'text', text: `Message ${i}\n\n${'Long content. '.repeat(60)}` }] }))
    if (opts.compacts) for (const i of [15, 55]) messages[i] = { ...messages[i], providerId: 'system', content: [{ type: 'text', text: '__compact__:auto:1000' }] }
    host.rows = messages
    host.calls = []
    host.responses = []
    host.failWindow = opts.failWindow
    host.holdWindow = opts.holdWindow
    host.index = { messageIds: messages.map(m => m.id), entries: messages.filter(m => m.role === 'user').map(m => ({
      id: m.id, index: Number(m.id.slice(1)), text: `Question ${m.id.slice(1)}`, createdAt: '', reply: 'Short reply preview' })),
      compacts: opts.compacts ? [{ id: 'm15', index: 15 }, { id: 'm55', index: 55 }] : [] }
    host.ReactNativeWebView = { postMessage(raw: string) {
      const request = JSON.parse(raw)
      if (request.type !== 'requestNative') return
      host.calls.push(request)
      if (request.action === 'loadNavigationIndex') {
        const response = { type: 'nativeActionResult', requestId: request.requestId, result: host.index }
        if (opts.holdIndex) host.responses.push(response)
        else queueMicrotask(() => host.__applyHost(response))
      }
      if (request.action === 'loadHistoryWindow') {
        const i = Number(request.payload.anchorId.slice(1)), direction = request.payload.direction
        const start = direction === 'before' ? Math.max(0, i - 8) : direction === 'after' ? i + 1 : Math.max(0, i - 2)
        const end = direction === 'before' ? i : Math.min(100, start + 8)
        const response = { type: 'nativeActionResult', requestId: request.requestId,
          ...(host.failWindow ? { error: 'Temporarily unavailable' } : { result: { messages: messages.slice(start, end) } }) }
        if (host.holdWindow) host.responses.push(response)
        else queueMicrotask(() => host.__applyHost(response))
      }
    } }
  }, opts)
  await page.goto(url)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate(() => (window as any).__applyHost({ type: 'hydrate', historyNavigation: true, hasMoreHistory: true, messages: (window as any).rows.slice(-8) }))
}
const jump = (page: Page, id: string) => page.locator(`[data-tick="${id}"]`).evaluate((element: HTMLElement) => element.click())
const calls = (page: Page) => page.evaluate(() => (window as any).calls.filter((call: any) => call.action === 'loadHistoryWindow').map((call: any) => call.payload))

test('shows the complete outline with only the latest eight messages mounted', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-tick]')).toHaveCount(50)
  await expect(page.locator('main')).toHaveAttribute('data-mounted-turns', '8')
  await expect(page.locator('[data-turn-id="m99"]')).toBeInViewport()
  expect(await calls(page)).toEqual([])
  await expect(page.locator('[data-turn-id="m0"]')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('full-navigation.png') })
})

test('jumps directly to an unloaded turn and then loads its preceding page', async ({ page }) => {
  await open(page)
  await jump(page, 'm20')
  await expect(page.locator('[data-turn-id="m20"]')).toBeInViewport()
  expect(await calls(page)).toEqual([{ anchorId: 'm20', direction: 'around' }])
  await expect(page.locator('[data-turn-id="m92"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Load earlier' }).evaluate((element: HTMLElement) => element.click())
  await expect.poll(() => calls(page)).toContainEqual({ anchorId: 'm18', direction: 'before' })
  await expect(page.locator('[data-turn-id="m10"]')).toHaveCount(1)
  await expect(page.locator('[data-tick]')).toHaveCount(50)
})

test('scrolling down from an old page loads adjacent history instead of skipping to the latest page', async ({ page }) => {
  await open(page)
  await jump(page, 'm20')
  await expect(page.locator('[data-turn-id="m20"]')).toBeInViewport()
  await expect.poll(async () => {
    await page.mouse.move(180, 500)
    await page.mouse.wheel(0, 5000)
    return calls(page)
  }).toContainEqual({ anchorId: 'm25', direction: 'after' })
  await expect(page.locator('[data-turn-id="m26"]')).toHaveCount(1)
  await expect(page.locator('[data-turn-id="m92"]')).toHaveCount(0)
})

test('live updates preserve the historical reading position and extend the full rail', async ({ page }) => {
  await open(page)
  await jump(page, 'm20')
  await expect(page.locator('[data-turn-id="m20"]')).toBeInViewport()
  const before = await page.locator('[data-turn-id="m20"]').evaluate(el => el.getBoundingClientRect().top)
  await page.evaluate(() => {
    const host = window as any
    host.__applyHost({ type: 'applyReductionPatch', messagePatches: [
      { ...host.rows[99], content: [{ type: 'text', text: 'New live output' }] },
      { ...host.rows[0], id: 'm100', content: [{ type: 'text', text: 'Newest question' }] },
    ], messageOrder: [...host.rows.slice(18,26).map((m: any) => m.id), ...host.rows.slice(92).map((m: any) => m.id), 'm100'] })
  })
  await expect(page.locator('[data-tick]')).toHaveCount(51)
  await expect(page.locator('[data-turn-id="m20"]')).toBeInViewport()
  expect(Math.abs(await page.locator('[data-turn-id="m20"]').evaluate(el => el.getBoundingClientRect().top) - before)).toBeLessThan(2)
})

test('failed jumps keep the current transcript and offer retry', async ({ page }) => {
  await open(page, { failWindow: true })
  await jump(page, 'm20')
  await expect(page.getByTestId('navigation-feedback').getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.locator('[data-turn-id="m99"]')).toHaveCount(1)
  await page.evaluate(() => { (window as any).failWindow = false })
  await page.getByTestId('navigation-feedback').getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('[data-turn-id="m20"]')).toBeInViewport()
})

test('a late jump response cannot replace a newly opened session', async ({ page }) => {
  await open(page, { holdWindow: true })
  await jump(page, 'm20')
  await expect.poll(() => calls(page)).toHaveLength(1)
  await page.evaluate(() => {
    const host = window as any
    host.__applyHost({ type: 'hydrate', messages: [{ ...host.rows[0], id: 'other-session' }] })
    for (const response of host.responses) host.__applyHost(response)
  })
  await expect(page.locator('[data-turn-id="other-session"]')).toHaveCount(1)
  await expect(page.locator('[data-turn-id="m20"]')).toHaveCount(0)
})

test('the first paint does not wait for the navigation index', async ({ page }) => {
  await open(page, { holdIndex: true })
  await expect(page.locator('[data-turn-id="m99"]')).toBeInViewport()
  await page.evaluate(() => { const host = window as any; for (const response of host.responses) host.__applyHost(response) })
  await expect(page.locator('[data-tick]')).toHaveCount(50)
  expect(await calls(page)).toEqual([])
})

test('all compact separators remain navigable without expanding their bodies', async ({ page }) => {
  await open(page, { compacts: true })
  await expect(page.locator('[data-compact-tick]')).toHaveCount(2)
  await page.locator('[data-compact-tick]').first().evaluate((element: HTMLElement) => element.click())
  await expect(page.locator('[data-turn-id="m15"]')).toBeInViewport()
  expect(await calls(page)).toContainEqual({ anchorId: 'm15', direction: 'around' })
})


test('a slower previous jump cannot override the most recent selected tick', async ({ page }) => {
  await open(page, { holdWindow: true })
  await jump(page, 'm20')
  await jump(page, 'm40')
  await expect.poll(() => calls(page)).toHaveLength(2)
  await page.evaluate(() => {
    const host = window as any
    host.__applyHost(host.responses[1])
    host.__applyHost(host.responses[0])
  })
  await expect(page.locator('[data-turn-id="m40"]')).toBeInViewport()
  await expect(page.locator('[data-turn-id="m20"]')).toHaveCount(0)
})

test('paging upward still reveals older rows after reaching the forty-row ceiling', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-tick]')).toHaveCount(50)
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Load earlier' }).evaluate((element: HTMLElement) => element.click())
    await expect.poll(async () => (await calls(page)).filter((call: any) => call.direction === 'before').length).toBe(i + 1)
    await expect(page.locator(`[data-turn-id="m${84 - i * 8}"]`)).toHaveCount(1)
  }
  expect(Number(await page.locator('main').getAttribute('data-mounted-turns'))).toBeLessThanOrEqual(40)
})
