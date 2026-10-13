import { expect, test } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { compactProcessHistory } from '../src/fixtures/transcript-segmentation'
import type { ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { buildCompactBoundaryMessage } from '@superone/shared/compact-boundary'

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
})

test('one Detail folds process on both sides of a compaction in a completed turn', async ({ page }) => {
  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'hydrate', messages, sessionStatus: 'idle' }), compactProcessHistory())

  const detail = page.locator('.turn-detail-section button')
  await expect(detail).toHaveCount(1)
  await expect(detail).toHaveAttribute('aria-expanded', 'false')
  await expect(detail).toContainText('6')
  await expect(page.getByText('Continuing the implementation.')).toBeVisible()
  await expect(page.getByText('The implementation is ready.')).toBeVisible()
  await expect(page.locator('[data-turn-id="process-compact"]')).toBeVisible()
  await expect(page.getByText('echo before-compact', { exact: true })).toHaveCount(0)
  await expect(page.getByText('echo after-compact', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Thought for/)).toHaveCount(0)

  await detail.click()
  await expect(page.getByText('echo before-compact', { exact: true })).toBeVisible()
  await expect(page.getByText('echo after-compact', { exact: true })).toBeVisible()
  await expect(page.getByText(/Thought for/)).toBeVisible()
  const order = await page.locator('article[data-turn-id], [data-turn-id="process-compact"]').evaluateAll(elements => elements.map(el => el.getAttribute('data-turn-id')))
  expect(order).toEqual(['compact-process', 'process-compact', 'compact-process:after:process-compact'])
  await detail.click()
  await expect(page.getByText('echo before-compact', { exact: true })).toHaveCount(0)
  await expect(page.getByText('echo after-compact', { exact: true })).toHaveCount(0)
})

test('uses the whole-turn threshold when each side of the cut has few tools', async ({ page }) => {
  const [source, compact] = compactProcessHistory()
  source!.content = source!.content.filter(block => !('toolUseId' in block) || !['before-1', 'before-2', 'before-3'].includes(block.toolUseId))
  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'hydrate', messages, sessionStatus: 'idle' }), [source, compact])
  const detail = page.locator('.turn-detail-section button')
  await expect(detail).toHaveCount(1)
  await expect(detail).toContainText('3')
  await expect(page.getByText('echo before-compact', { exact: true })).toHaveCount(0)
  await expect(page.getByText('echo after-compact', { exact: true })).toHaveCount(0)
  await detail.click()
  await expect(page.getByText('echo after-compact', { exact: true })).toBeVisible()
})

test('folds a live continuation when the turn completes', async ({ page }, info) => {
  const history = compactProcessHistory()
  const streaming: ChatMessage = { ...history[0]!, status: 'streaming' }
  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'hydrate', messages, sessionStatus: 'streaming' }),
    [streaming, history[1]])
  await expect(page.getByText('echo after-compact', { exact: true })).toBeVisible()

  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'applyReductionPatch', messages, sessionStatus: 'idle' }), history)
  await expect(page.locator('.turn-detail-section button')).toHaveCount(1)
  await expect(page.getByText('echo before-compact', { exact: true })).toHaveCount(0)
  await expect(page.getByText('echo after-compact', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Thought for/)).toHaveCount(0)
  await expect(page.getByText('The implementation is ready.')).toBeVisible()
  await page.evaluate(() => {
    (globalThis as any).__applyHost({ type: 'setTheme', scheme: 'dark' })
    window.scrollTo(0, 0)
  })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: info.outputPath('compact-process-collapsed.png') })
})

test('shows the shared disclosure when compaction precedes the first output', async ({ page }) => {
  const [complete] = compactProcessHistory()
  const empty: ChatMessage = { ...complete!, status: 'streaming', content: [] }
  const compact = buildCompactBoundaryMessage({ type: 'compact_boundary', trigger: 'auto', preTokens: 120_000, postTokens: 20_000 },
    'empty-compact', empty.createdAt, empty, [empty])
  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'hydrate', messages, sessionStatus: 'idle' }), [complete, compact])
  await expect(page.locator('.turn-detail-section button')).toHaveCount(1)
  await expect(page.locator('.turn-detail-section button')).toContainText('6')
  await expect(page.getByText('echo after-compact', { exact: true })).toHaveCount(0)
  await page.locator('.turn-detail-section button').click()
  await expect(page.getByText('echo after-compact', { exact: true })).toBeVisible()
})

test('keeps an unfinished tool tail visible across the cut', async ({ page }) => {
  const [source, compact] = compactProcessHistory()
  source!.status = 'interrupted'
  source!.content = source!.content.slice(0, -1)
  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'hydrate', messages, sessionStatus: 'idle' }), [source, compact])
  await expect(page.locator('.turn-detail-section button')).toHaveCount(1)
  await expect(page.getByText('echo before-compact', { exact: true })).toBeVisible()
  await expect(page.getByText('echo after-compact', { exact: true })).toBeVisible()
})

test('one Detail controls a legacy Codex turn split by multiple compactions', async ({ page }) => {
  const command = (id: string): CodexThreadItem => ({ id, type: 'command_execution', command: `echo ${id}`,
    aggregatedOutput: '', status: 'completed', exitCode: 0 })
  const source: ChatMessage = { id: 'legacy-process', role: 'assistant', providerId: 'codex', content: [],
    status: 'streaming', createdAt: '', metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'progress', type: 'agent_message', text: 'Continuing the implementation.' },
      { id: 'thinking-before', type: 'reasoning', text: 'Plan the work.' }, command('before-compact'),
    ] } } }
  const event = { type: 'compact_boundary' as const, trigger: 'auto' as const, preTokens: 120_000, postTokens: 20_000 }
  const first = buildCompactBoundaryMessage(event, 'legacy-first', '', source, [source])
  const middle: ChatMessage = { ...source, metadata: { codex: { ...source.metadata!.codex!, items: [
    ...source.metadata!.codex!.items, command('between-compacts'),
  ] } } }
  const second = buildCompactBoundaryMessage(event, 'legacy-second', '', middle, [first, middle])
  const complete: ChatMessage = { ...middle, status: 'complete', metadata: { codex: { ...middle.metadata!.codex!, items: [
    ...middle.metadata!.codex!.items, command('after-compacts'),
    { id: 'thinking-after', type: 'reasoning', text: 'Verify the change.' },
    { id: 'answer', type: 'agent_message', text: 'The implementation is ready.' },
  ] } } }
  await page.evaluate(messages => (globalThis as any).__applyHost({ type: 'hydrate', messages, sessionStatus: 'idle' }), [complete, first, second])
  const detail = page.locator('.turn-detail-section button')
  await expect(detail).toHaveCount(1)
  await expect(detail).toContainText('3')
  for (const id of ['before-compact', 'between-compacts', 'after-compacts']) {
    await expect(page.getByText(`echo ${id}`, { exact: true })).toHaveCount(0)
  }
  await expect(page.getByText('The implementation is ready.')).toBeVisible()
  await detail.click()
  for (const id of ['before-compact', 'between-compacts', 'after-compacts']) {
    await expect(page.getByText(`echo ${id}`, { exact: true })).toBeVisible()
  }
  await detail.click()
  await expect(page.getByText('echo after-compacts', { exact: true })).toHaveCount(0)
})
