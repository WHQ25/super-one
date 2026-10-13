import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { streamingAsyncAnswerHistory } from '../src/fixtures/transcript-segmentation'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const sourceId = 'streaming-async-turn'
const answerId = 'codex_async_answer:streaming-question'
const continuationId = `${sourceId}:after:${answerId}`

async function stream(page: Page, stage: number) {
  await page.evaluate(({ messages, type }) => {
    const host = globalThis as typeof globalThis & { __applyHost: (value: unknown) => void }
    host.__applyHost({ type, messages, sessionStatus: 'streaming' })
  }, { messages: streamingAsyncAnswerHistory(stage), type: stage ? 'applyReductionPatch' : 'hydrate' })
}

test('keeps the growing sentence above its async answer and starts the continuation at the next block', async ({ page }) => {
  await page.context().setOffline(true)
  await page.addInitScript(() => { Object.assign(globalThis, { ReactNativeWebView: { postMessage() {} } }) })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate(() => {
    const host = globalThis as typeof globalThis & { __applyHost: (value: unknown) => void }
    host.__applyHost({ type: 'channelToken', token: 'async-answer-streaming-test' })
  })
  const source = page.locator(`[data-turn-id="${sourceId}"]`)
  const continuation = page.locator(`[data-turn-id="${continuationId}"]`)
  await stream(page, 0)
  await expect(source).toContainText('长消息顶部的“')
  await expect(page.locator('[data-codex-async-answer]')).toBeVisible()
  await stream(page, 1)
  await expect(source).toContainText('更早部分”文字。我会去掉这些提示。')
  await expect(continuation).not.toContainText('更早部分')
  await stream(page, 2)
  await expect(continuation).toContainText('明白，加载前后都不显示任何提示。')
  await expect(continuation).not.toContainText('更早部分')
  await expect(source.locator('.chat-md')).toHaveCount(1)
  await expect.poll(() => page.locator('article[data-turn-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-turn-id'))))
    .toEqual([sourceId, answerId, continuationId])
  await page.screenshot({ path: test.info().outputPath('async-answer-block-boundary.png') })
})
