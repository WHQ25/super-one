import { expect, test, type Locator, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { HostInbound } from '../src/protocol'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const clockStart = new Date('2026-09-08T00:00:00.000Z')

function message(id: string, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'streaming',
    content: [{ type: 'text', text }],
    createdAt: clockStart.toISOString(),
    providerId: 'claude',
    ...overrides,
  }
}

function codexMessage(id: string, text: string, options: {
  status?: ChatMessage['status']
  contentBackup?: boolean
  agentMessage?: boolean
} = {}): ChatMessage {
  return message(id, text, {
    providerId: 'codex',
    status: options.status ?? 'streaming',
    content: options.contentBackup ? [{ type: 'text', text }] : [],
    metadata: {
      codex: {
        threadId: 'simulated-stream-thread',
        usage: null,
        items: options.agentMessage === false ? [] : [{ id: 'answer', type: 'agent_message', text }],
      },
    },
  })
}

async function send(page: Page, envelope: HostInbound): Promise<void> {
  await page.evaluate((value) => {
    const target = globalThis as typeof globalThis & { __applyHost?: (message: unknown) => void }
    if (!target.__applyHost) throw new Error('Chat host bridge is unavailable')
    target.__applyHost(value)
  }, envelope)
}

function turn(page: Page, id: string): Locator {
  return page.locator(`article[data-turn-id="${id}"]`)
}

async function markdownText(article: Locator): Promise<string> {
  return (await article.locator('.chat-md').allTextContents()).join('')
}

async function expectText(article: Locator, text: string): Promise<void> {
  await expect.poll(() => markdownText(article)).toBe(text)
}

async function expectPlaying(article: Locator): Promise<void> {
  await expect(article).toHaveAttribute('data-simulated-streaming', 'true')
}

async function expectDrained(article: Locator, text: string): Promise<void> {
  await expectText(article, text)
  await expect(article).not.toHaveAttribute('data-simulated-streaming', 'true')
}

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.clock.install({ time: clockStart })
  await page.addInitScript(() => {
    const target = globalThis as typeof globalThis & {
      ReactNativeWebView: { postMessage(message: string): void }
    }
    target.ReactNativeWebView = { postMessage() {} }
  })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000))
})

for (const type of ['initialize', 'hydrate'] as const) {
  test(`${type} renders completed and in-progress history without playback`, async ({ page }) => {
    const completed = 'Stored completed history '.repeat(30).trim()
    const inProgress = 'Stored in-progress history '.repeat(30).trim()
    await send(page, {
      type,
      sessionStatus: 'streaming',
      messages: [message('history', completed, { status: 'complete' }), message('in-progress', inProgress)],
    })

    await expectDrained(turn(page, 'history'), completed)
    await expectDrained(turn(page, 'in-progress'), inProgress)
  })
}

test('live assistant chunks reveal complete graphemes in order', async ({ page }) => {
  const text = '你好👩🏽‍💻e\u0301👨‍👩‍👧‍👦🇨🇳'.repeat(60)
  const prefixes = new Set([''])
  let prefix = ''
  for (const { segment } of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)) {
    prefix += segment
    prefixes.add(prefix)
  }
  await send(page, { type: 'hydrate', messages: [] })
  await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('unicode', text)] })
  const article = turn(page, 'unicode')
  await expectPlaying(article)

  let previous = ''
  for (let sample = 0; sample < 4; sample++) {
    await page.clock.runFor(100)
    const visible = await markdownText(article)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(text.length)
    expect(prefixes.has(visible), 'Playback must stop at a grapheme boundary').toBe(true)
    expect(visible.startsWith(previous), 'Previously painted text must remain visible').toBe(true)
    previous = visible
  }
  await page.clock.runFor(4_600)
  await expectDrained(article, text)
})

test('a final complete patch still animates and drains within five seconds', async ({ page }, testInfo) => {
  const text = 'Final live answer '.repeat(240).trim()
  await send(page, { type: 'hydrate', messages: [] })
  await send(page, {
    type: 'applyReductionPatch',
    sessionStatus: 'idle',
    messages: [message('final', text, { status: 'complete' })],
  })
  const article = turn(page, 'final')
  await expectPlaying(article)
  await page.clock.runFor(100)
  const partial = await markdownText(article)
  expect(partial.length).toBeGreaterThan(0)
  expect(partial.length).toBeLessThan(text.length)
  expect(text.startsWith(partial)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('text-mid-playback.png'), animations: 'disabled' })

  await page.clock.runFor(4_900)
  await expectDrained(article, text)
  await expect(article).toHaveAttribute('data-message-status', 'complete')
  await page.screenshot({ path: testInfo.outputPath('text-complete.png'), animations: 'disabled' })
})

test('a later chunk continues from the visible prefix without duplication', async ({ page }) => {
  const history = 'Already visible.'
  const first = `${history} ${'first chunk '.repeat(40)}`
  const second = `${first}${'second chunk '.repeat(40)}`.trim()
  await send(page, { type: 'hydrate', sessionStatus: 'streaming', messages: [message('chunks', history)] })
  await expectDrained(turn(page, 'chunks'), history)
  await send(page, { type: 'applyReductionPatch', messages: [message('chunks', first)] })
  const article = turn(page, 'chunks')
  await expectPlaying(article)
  await page.clock.runFor(150)
  const beforeNextChunk = await markdownText(article)
  expect(beforeNextChunk.startsWith(history)).toBe(true)
  expect(beforeNextChunk.length).toBeLessThan(first.length)

  await send(page, { type: 'applyReductionPatch', messages: [message('chunks', second)] })
  await page.clock.runFor(150)
  const afterNextChunk = await markdownText(article)
  expect(afterNextChunk.startsWith(beforeNextChunk)).toBe(true)
  expect(afterNextChunk.length).toBeGreaterThan(beforeNextChunk.length)
  expect(second.startsWith(afterNextChunk)).toBe(true)
  await page.clock.runFor(4_850)
  await expectDrained(article, second)
})

test('fenced code reveals incrementally and retains its final code block', async ({ page }, testInfo) => {
  const code = `const result = "${'mobileStream'.repeat(60)}";`
  const text = `\`\`\`js\n${code}\n\`\`\``
  await send(page, { type: 'hydrate', messages: [] })
  await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('code', text)] })
  const article = turn(page, 'code')
  await expectPlaying(article)
  await page.clock.runFor(500)
  const block = article.locator('[data-chat-codeblock]')
  await expect(block).toHaveCount(1)
  const partial = await block.locator('code').innerText()
  expect(partial.length).toBeGreaterThan(0)
  expect(partial.length).toBeLessThan(code.length)
  expect(code.startsWith(partial.trimEnd())).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('code-mid-playback.png'), animations: 'disabled' })

  await page.clock.runFor(4_500)
  await expect(article).not.toHaveAttribute('data-simulated-streaming', 'true')
  await expect(block.locator('code')).toHaveText(code)
  await page.screenshot({ path: testInfo.outputPath('code-complete.png'), animations: 'disabled' })
})

for (const type of ['reset', 'hydrate'] as const) {
  test(`${type} cancels old playback even when a message ID is reused`, async ({ page }) => {
    const oldText = 'Old pending answer '.repeat(160).trim()
    const replacement = 'Replacement snapshot is fully visible'
    await send(page, { type: 'hydrate', messages: [] })
    await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('reused', oldText)] })
    const article = turn(page, 'reused')
    await expectPlaying(article)
    await page.clock.runFor(100)

    if (type === 'reset') {
      await send(page, { type: 'reset' })
      await expect(article).toHaveCount(0)
    }
    await send(page, {
      type: type === 'reset' ? 'initialize' : 'hydrate',
      sessionStatus: 'idle',
      messages: [message('reused', replacement, { status: 'complete' })],
    })
    await expectDrained(article, replacement)
    await page.clock.runFor(5_000)
    await expectDrained(article, replacement)
  })
}

for (const status of ['interrupted', 'error'] as const) {
  test(`${status} immediately drains queued text`, async ({ page }) => {
    const text = 'Pending answer '.repeat(160).trim()
    await send(page, { type: 'hydrate', messages: [] })
    await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('stopped', text)] })
    const article = turn(page, 'stopped')
    await expectPlaying(article)
    await page.clock.runFor(100)
    expect((await markdownText(article)).length).toBeLessThan(text.length)

    await send(page, { type: 'applyReductionPatch', sessionStatus: 'idle', messages: [message('stopped', text, { status })] })
    await expectDrained(article, text)
    await expect(article).toHaveAttribute('data-message-status', status)
  })
}

test('Codex agent_message items receive the same progressive playback', async ({ page }) => {
  const text = 'Codex answer '.repeat(100).trim()
  await send(page, { type: 'hydrate', messages: [] })
  await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [codexMessage('codex', text)] })
  const article = turn(page, 'codex')
  await expectPlaying(article)
  await page.clock.runFor(100)
  const partial = await markdownText(article)
  expect(partial.length).toBeGreaterThan(0)
  expect(partial.length).toBeLessThan(text.length)
  expect(text.startsWith(partial)).toBe(true)
  await page.clock.runFor(4_900)
  await expectDrained(article, text)
})

for (const agentMessage of [true, false]) {
  const shape = agentMessage ? 'with duplicate content backup' : 'with content fallback only'
  test(`a completed Codex patch ${shape} visibly streams its answer`, async ({ page }) => {
    const text = 'The visible Codex final response '.repeat(100).trim()
    await send(page, { type: 'hydrate', messages: [] })
    await send(page, {
      type: 'applyReductionPatch',
      sessionStatus: 'idle',
      messages: [codexMessage('codex-final', text, { status: 'complete', contentBackup: true, agentMessage })],
    })
    const article = turn(page, 'codex-final')
    await expectPlaying(article)
    await page.clock.runFor(100)
    const partial = await markdownText(article)
    expect(partial.length, 'Playback must start with the visible answer, not a hidden backup').toBeGreaterThan(0)
    expect(partial.length).toBeLessThan(text.length)
    expect(text.startsWith(partial)).toBe(true)
    await page.clock.runFor(4_900)
    await expectDrained(article, text)
  })
}

for (const providerId of ['claude', 'codex'] as const) {
  test(`${providerId} plays thinking before the answer without collapsing it early`, async ({ page }, testInfo) => {
    const thinking = 'Thinking through the incoming chunks '.repeat(80).trim()
    const answer = 'The final answer follows the reasoning '.repeat(20).trim()
    const response = message('reasoning', answer, {
      providerId,
      status: 'complete',
      ...(providerId === 'claude'
        ? { content: [{ type: 'thinking', thinking }, { type: 'text', text: answer }] }
        : {
          content: [],
          metadata: {
            codex: {
              threadId: 'reasoning-stream-thread',
              usage: null,
              items: [
                { id: 'reasoning', type: 'reasoning', text: thinking },
                { id: 'answer', type: 'agent_message', text: answer },
              ],
            },
          },
        }),
    })
    await send(page, { type: 'hydrate', messages: [] })
    await send(page, { type: 'applyReductionPatch', sessionStatus: 'idle', messages: [response] })
    const article = turn(page, 'reasoning')
    await expectPlaying(article)

    let previous = ''
    for (let sample = 0; sample < 2; sample++) {
      await page.clock.runFor(100)
      const reasoning = article.locator('.thinking-content')
      await expect(reasoning).toBeVisible()
      const visible = await reasoning.innerText()
      expect(visible.length).toBeGreaterThan(0)
      expect(visible.length).toBeLessThan(thinking.length)
      expect(thinking.startsWith(visible)).toBe(true)
      expect(visible.startsWith(previous)).toBe(true)
      expect(await markdownText(article), 'The answer must wait for the preceding thinking').toBe('')
      previous = visible
    }
    await page.screenshot({ path: testInfo.outputPath(`${providerId}-thinking-mid-playback.png`), animations: 'disabled' })

    await page.clock.runFor(4_800)
    await expectDrained(article, answer)
    await page.screenshot({ path: testInfo.outputPath(`${providerId}-thinking-complete.png`), animations: 'disabled' })
  })
}

test('reduced motion immediately displays live patches', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const text = 'Live text with reduced motion '.repeat(100).trim()
  await send(page, { type: 'hydrate', messages: [] })
  await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('motion', text)] })
  await expectDrained(turn(page, 'motion'), text)
})

test('prepending history keeps old turns complete and live playback progressing', async ({ page }) => {
  const text = 'The live answer continues '.repeat(120).trim()
  const history = 'Earlier completed history '.repeat(30).trim()
  await send(page, { type: 'hydrate', messages: [] })
  await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('live', text)] })
  const article = turn(page, 'live')
  await expectPlaying(article)
  await page.clock.runFor(150)
  const beforeHistory = await markdownText(article)

  await send(page, { type: 'prependHistory', messages: [message('older', history, { status: 'complete' })] })
  await send(page, { type: 'setWindow', range: { start: 0, end: 2 } })
  await expectDrained(turn(page, 'older'), history)
  await expectPlaying(article)
  expect(await markdownText(article)).toBe(beforeHistory)

  await page.clock.runFor(100)
  const afterHistory = await markdownText(article)
  expect(afterHistory.startsWith(beforeHistory)).toBe(true)
  expect(afterHistory.length).toBeGreaterThan(beforeHistory.length)
  await page.clock.runFor(4_750)
  await expectDrained(article, text)
})
