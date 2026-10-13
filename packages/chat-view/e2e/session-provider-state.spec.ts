import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const item = { id: 'pending', text: 'Review the recovery results. '.repeat(5), delivery: 'queue', createdAt: 1, attachmentCount: 2 }
const send = (page: Page, message: unknown) => page.evaluate((value) => {
  (window as unknown as { __applyHost(value: unknown): void }).__applyHost(value)
}, message)
const requests = (page: Page) => page.evaluate(() => (window as unknown as {
  requests: { action: string; requestId: string; payload: unknown }[]
}).requests.filter((request) => request.action === 'sessionInboxAction' || request.action === 'reconnectAgent'))

async function open(page: Page, locale = 'en', disconnected = false) {
  await page.setViewportSize({ width: 320, height: 780 })
  await page.addInitScript(() => {
    const host = window as unknown as { ReactNativeWebView: { postMessage(raw: string): void }; requests: unknown[] }
    host.requests = []
    host.ReactNativeWebView = { postMessage: (raw) => host.requests.push(JSON.parse(raw)) }
  })
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await send(page, { type: 'channelToken', token: 'inbox-test' })
  await send(page, { type: 'setTheme', scheme: locale === 'zh' ? 'dark' : 'light' })
  await send(page, { type: 'setViewport', locale })
  await send(page, { type: 'hydrate', messages: [], sessionInbox: [item], harnessConnection: disconnected ? { state: 'disconnected', attempt: 5 } : null })
  await expect(page.locator('[data-session-provider-state]')).toBeVisible()
}

for (const locale of ['en', 'zh']) test(`native inbox waits for the shell reply, retains errors and updates at 320px (${locale})`, async ({ page }) => {
  await open(page, locale)
  const steer = page.getByRole('button', { name: locale === 'zh' ? '在下一个安全点执行' : 'Steer at Next Safe Point', exact: true })
  const withdraw = page.getByRole('button', { name: locale === 'zh' ? '撤回待执行输入' : 'Withdraw Pending Input' })
  await steer.click()
  await expect(withdraw).toBeDisabled()
  let request = (await requests(page)).at(-1)!
  expect(request).toMatchObject({ action: 'sessionInboxAction', payload: { inboxId: 'pending', action: 'steer' } })
  await send(page, { type: 'nativeActionResult', requestId: request.requestId, error: 'stale lease' })
  await expect(page.getByRole('alert')).toHaveText('stale lease')
  await expect(steer).toBeEnabled()
  await steer.click()
  request = (await requests(page)).at(-1)!
  await send(page, { type: 'nativeActionResult', requestId: request.requestId, result: { ok: true } })
  await send(page, { type: 'applyReductionPatch', sessionInbox: [{ ...item, delivery: 'steer' }] })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: locale === 'zh' ? '改为当前轮结束后执行' : 'Queue After Current Turn' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await withdraw.click()
  request = (await requests(page)).at(-1)!
  expect(request.payload).toEqual({ inboxId: 'pending', action: 'cancel' })
  await send(page, { type: 'nativeActionResult', requestId: request.requestId, result: { ok: true } })
  await send(page, { type: 'applyReductionPatch', sessionInbox: [] })
  await expect(page.locator('[data-session-provider-state]')).toHaveCount(0)
})

test('connection retry is an observation request and keeps input controls disabled until the connected projection arrives', async ({ page }) => {
  await open(page, 'en', true)
  const withdraw = page.getByRole('button', { name: 'Withdraw Pending Input' }), retry = page.getByRole('button', { name: 'Retry', exact: true })
  await expect(withdraw).toBeDisabled()
  await retry.click()
  const request = (await requests(page)).at(-1)!
  expect(request.action).toBe('reconnectAgent')
  expect((await requests(page)).some((request) => request.action === 'sessionInboxAction')).toBe(false)
  await send(page, { type: 'nativeActionResult', requestId: request.requestId, result: { ok: true } })
  await expect(withdraw).toBeDisabled()
  await send(page, { type: 'applyReductionPatch', harnessConnection: { state: 'connected', attempt: 1 } })
  await expect(withdraw).toBeEnabled()
})
