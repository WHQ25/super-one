import { expect, test } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'
import { pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'

const questionText = 'Which environment?\nPlease confirm whether this update should cover the desktop app, the mobile app, or both, and whether the complete existing deployment schedule and validation steps should remain in place.'
const question: ChatMessage = {
  id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex',
  metadata: { codex: { threadId: 'thread', usage: null, items: [{
    id: 'question', type: 'agent_message', delivery: 'async', text: '',
    questions: [{ title: questionText, options: ['Staging', 'Production'] }],
  }, { id: 'second', type: 'agent_message', delivery: 'async', text: '', questions: [{ title: 'What deadline?', options: null }] }] } },
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
  await send({ type: 'channelToken', token: 'async-question-test' })
  await send({ type: 'setTheme', scheme: width === 390 ? 'dark' : 'light' })
  const pending = pendingCodexAsyncQuestions([question])
  await send({ type: 'hydrate', messages: [question], pendingAsyncQuestions: pending })
  await expect(page.getByText('Which environment?')).toBeVisible()
  await expect(page.locator('article')).not.toContainText('Which environment?')
  await expect(page.getByText('What deadline?')).toHaveCount(0)
  const input = page.getByRole('textbox')
  const submit = page.getByRole('button', { name: /Submit/ })
  await input.fill('Preview branch')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
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
  const reply: ChatMessage = { id: 'codex_async_answer:question', role: 'user', status: 'complete', content: [{ type: 'text', text: 'Preview branch', codexAsyncQuestions: pending[0]!.item.questions }], createdAt: '', providerId: 'codex' }
  await send({ type: 'applyReductionPatch', messagePatches: [reply], messageOrder: [question.id, reply.id], pendingAsyncQuestions: pending.slice(1) })
  const bubble = page.locator('[data-message-role="user"] .portable-user-message')
  await expect(bubble).toContainText('Which environment?')
  await expect(bubble).not.toContainText('Your Answer')
  await expect(bubble.locator('blockquote')).toHaveText(questionText)
  await expect(bubble).toContainText('Preview branch')
  await expect(page.locator('[data-bottom-dock]')).toContainText('What deadline?')
  // The saved Q&A restores without loading its source turn.
  await send({ type: 'reset' })
  await send({ type: 'hydrate', messages: [reply], pendingAsyncQuestions: [] })
  await expect(page.getByText('Preview branch', { exact: true })).toHaveCount(1)
  await expect(bubble).toContainText('Which environment?')
  await expect(bubble.locator('blockquote')).toHaveText(questionText)
  expect(await bubble.locator('blockquote').evaluate(element => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Submit/ })).toHaveCount(0)
  await expect(page.locator('[data-tick="codex_async_answer:question"]')).toHaveCount(0)
  await page.screenshot({ path: `/tmp/async-question-${width}-answered.png` })
})
