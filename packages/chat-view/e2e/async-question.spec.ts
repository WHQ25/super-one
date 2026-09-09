import { expect, test } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'

const question: ChatMessage = {
  id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex',
  metadata: { codex: { threadId: 'thread', usage: null, items: [{
    id: 'question', type: 'agent_message', delivery: 'async', text: '',
    questions: [{ title: 'Which environment?', options: ['Staging', 'Production'] }],
  }] } },
}

for (const width of [390, 1024]) test(`async question answers, retries, and restores at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 780 })
  await page.addInitScript(() => {
    const host = window as unknown as { ReactNativeWebView: { postMessage(value: string): void }; requests: Record<string, unknown>[] }
    host.requests = []
    host.ReactNativeWebView = { postMessage: value => host.requests.push(JSON.parse(value)) }
  })
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  const send = (message: unknown) => page.evaluate(value => {
    (window as unknown as { __applyHost(value: unknown): void }).__applyHost(value)
  }, message)
  await send({ type: 'setTheme', scheme: width === 390 ? 'dark' : 'light' })
  await send({ type: 'hydrate', messages: [question] })
  await expect(page.getByText('Which environment?')).toBeVisible()
  const input = page.getByRole('textbox', { name: 'Which environment?' })
  const submit = page.getByRole('button', { name: /Submit/ })
  await input.fill('Preview branch')
  const inputBox = (await input.boundingBox())!
  const submitBox = (await submit.boundingBox())!
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(submitBox.x)
  await page.screenshot({ path: `/tmp/async-question-${width}.png` })
  await submit.click()
  await expect(submit).toBeDisabled()
  const requests = () => page.evaluate(() => (window as unknown as { requests: { action?: string; requestId: string; payload: unknown }[] }).requests.filter(request => request.action === 'codexAsyncQuestionAnswer'))
  let request = (await requests()).at(-1)!
  expect(request.payload).toEqual({ messageId: 'turn', itemId: 'question', answers: ['Preview branch'] })
  await send({ type: 'nativeActionResult', requestId: request.requestId, error: 'No active turn' })
  await expect(page.getByRole('alert')).toHaveText('No active turn')
  await expect(input).toHaveValue('Preview branch')
  await submit.click()
  request = (await requests()).at(-1)!
  await send({ type: 'nativeActionResult', requestId: request.requestId, result: { ok: true } })
  await expect(page.getByRole('status')).toContainText('Answered')
  const reply: ChatMessage = { id: 'codex_async_answer:question', role: 'user', status: 'complete', content: [{ type: 'text', text: 'Preview branch' }], createdAt: '', providerId: 'codex' }
  await send({ type: 'reset' })
  await send({ type: 'hydrate', messages: [question, reply] })
  await expect(page.getByRole('status')).toContainText('Answered')
  await expect(page.getByText('Preview branch', { exact: true })).toHaveCount(1)
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(0)
  await expect(page.locator('[data-tick="codex_async_answer:question"]')).toHaveCount(0)
  await page.screenshot({ path: `/tmp/async-question-${width}-answered.png` })
})
