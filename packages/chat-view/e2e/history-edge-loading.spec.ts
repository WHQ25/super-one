import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import { collapsedHistoryTranscript } from '../src/fixtures/collapsed-history'
import type { TranscriptWindowPage } from '../src/protocol'

const url = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href

function fixture(longPrefix = false) {
  const transcript = collapsedHistoryTranscript()
  if (longPrefix) (transcript[1].content[0] as { text: string }).text += 'Older explanation. '.repeat(2000)
  const source = windowSource(transcript)
  let window = applyWindowResult(null, { ...selectTranscriptWindow(source, {}, DEFAULT_WINDOW_BUDGET), total: transcript.length }, EMPTY_WINDOW_LOOKUP).state
  const page = (): TranscriptWindowPage => ({ messages: window.messages.map(materializeWindowMessage), messageOrder: window.messages.map(m => m.id),
    replace: false, hasMoreHistory: window.older !== null, hasNewerHistory: false })
  const tail = page()
  const pages: TranscriptWindowPage[] = []
  while (window.older) {
    window = applyWindowResult(window, { ...selectTranscriptWindow(source, { anchor: window.older, direction: 'before' }, DEFAULT_WINDOW_BUDGET), total: transcript.length }, EMPTY_WINDOW_LOOKUP, 'older').state
    pages.push(page())
  }
  return { tail, pages }
}

async function open(page: Page, options: { hold?: boolean; noProgress?: boolean; newer?: boolean; longPrefix?: boolean; holdIndex?: boolean } = {}) {
  const data = fixture(options.longPrefix)
  if (options.newer) {
    data.tail = { messages: [textMessage('middle', 'assistant', 'Middle of the conversation.')], messageOrder: ['middle'], replace: false, hasMoreHistory: false, hasNewerHistory: true }
    data.pages = [{ ...data.tail, messages: [textMessage('next', 'assistant', 'Next message. '.repeat(400))], messageOrder: ['middle', 'next'], hasNewerHistory: false }]
  }
  await page.context().setOffline(true)
  await page.addInitScript(({ data, options }) => {
    const host = window as any
    host.calls = []
    let index = 0
    host.ReactNativeWebView = { postMessage(raw: string) {
      const request = JSON.parse(raw)
      if (request.type !== 'requestNative' || !['loadEarlier', 'loadWindowPage'].includes(request.action)) return
      host.calls.push(request.action)
      const result = options.noProgress ? data.tail : data.pages[index++] ?? data.pages.at(-1)
      host.lastResult = result
      const reply = (error?: string) => host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId, ...(error ? { error } : { result }) })
      if (options.hold) host.finishPage = reply
      else queueMicrotask(() => reply())
    } }
  }, { data, options })
  await page.goto(url)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate(() => (window as any).__applyHost({ type: 'channelToken', token: 'playwright-edges' }))
  await page.evaluate(({ tail, holdIndex }) => (window as any).__applyHost({ type: 'hydrate', transcriptWindow: true,
    historyNavigation: holdIndex, sessionStatus: 'idle', ...tail }), { tail: data.tail, holdIndex: options.holdIndex })
  return data
}

test('fills the first screen across several collapsed-only pages without a gesture', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-turn-id="reply"]')).toContainText('Opening explanation.')
  expect(await page.evaluate(() => (window as any).calls.length)).toBeGreaterThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
  await expect(page.getByTestId('edge-loader-top')).toHaveCount(0)
  await expect(page.getByText('Earlier part of this message', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Load earlier|Load later|Retry/ })).toHaveCount(0)
  await page.evaluate(message => (window as any).__applyHost({ type: 'applyReductionPatch',
    messagePatches: [message], messageOrder: ['ask', 'reply', 'live'] }), textMessage('live', 'assistant', 'New live output.'))
  await expect(page.locator('[data-turn-id="live"]')).toBeInViewport()
})

test('loads a visible later edge automatically and shows only Loading while waiting', async ({ page }) => {
  await open(page, { newer: true, hold: true })
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['loadWindowPage'])
  await expect(page.getByTestId('edge-loader-bottom')).toHaveText('Loading...')
  await expect(page.getByTestId('edge-loader-top')).toHaveCount(0)
  await page.evaluate(() => (window as any).finishPage())
  await expect(page.locator('[data-turn-id="next"]')).toHaveCount(1)
  await expect(page.getByTestId('edge-loader-bottom')).toHaveCount(0)
})

test('automatic first-screen loading does not wait for a stalled navigation index', async ({ page }) => {
  await open(page, { holdIndex: true })
  await expect(page.locator('[data-turn-id="reply"]')).toContainText('Opening explanation.')
  await expect(page.getByTestId('edge-loader-top')).toHaveCount(0)
})

test('a failed automatic load stays silent without repeatedly fetching the same edge', async ({ page }) => {
  await open(page, { hold: true })
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['loadEarlier'])
  await expect(page.getByTestId('edge-loader-top')).toHaveText('Loading...')
  await page.evaluate(() => (window as any).finishPage('Temporary history failure'))
  await expect(page.getByTestId('edge-loader-top')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['loadEarlier'])
  await page.mouse.wheel(0, -100)
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['loadEarlier', 'loadEarlier'])
  await expect(page.getByTestId('edge-loader-top')).toHaveText('Loading...')
})

test('stops automatic paging when the visible content fills a screen with older history remaining', async ({ page }) => {
  await open(page, { longPrefix: true })
  await expect(page.locator('[data-turn-id="reply"]')).toContainText('Older explanation.')
  expect(await page.evaluate(() => (window as any).lastResult.hasMoreHistory)).toBe(true)
  const count = await page.evaluate(() => (window as any).calls.length)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(count)
})

test('a narrow dark viewport shows the localized Loading indicator without historical notices', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 })
  await open(page, { hold: true })
  await page.evaluate(() => {
    const host = window as any
    host.__applyHost({ type: 'setTheme', scheme: 'dark' })
    host.__applyHost({ type: 'setViewport', locale: 'zh' })
  })
  await expect(page.getByTestId('edge-loader-top')).toHaveText('加载中...')
  await expect(page.getByRole('status')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Load earlier|Load later|Retry/ })).toHaveCount(0)
})

test('a page that makes no coverage progress does not cause an automatic request loop', async ({ page }) => {
  await open(page, { noProgress: true })
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['loadEarlier'])
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['loadEarlier'])
})

test('a late automatic page cannot replace a newly opened session', async ({ page }) => {
  await open(page, { hold: true })
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['loadEarlier'])
  await page.evaluate(message => {
    const host = window as any
    host.__applyHost({ type: 'hydrate', transcriptWindow: true, hasMoreHistory: false, hasNewerHistory: false, messages: [message] })
    host.finishPage()
  }, textMessage('other', 'assistant', 'Another session.'))
  await expect(page.locator('[data-turn-id="other"]')).toHaveCount(1)
  await expect(page.locator('[data-turn-id="reply"]')).toHaveCount(0)
})
