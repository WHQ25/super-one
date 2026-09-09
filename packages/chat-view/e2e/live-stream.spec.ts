import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { HostInbound } from '../src/protocol'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
function message(id: string, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', status: 'streaming', content: [{ type: 'text', text }],
    createdAt: '2026-09-09T00:00:00Z', providerId: 'claude', ...overrides }
}
async function send(page: Page, envelope: HostInbound) {
  await page.evaluate((value) => {
    const host = globalThis as typeof globalThis & { __applyHost: (message: unknown) => void }
    host.__applyHost(value)
  }, envelope)
}

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.clock.install()
  await page.addInitScript(() => {
    Object.assign(globalThis, { ReactNativeWebView: { postMessage() {} } })
  })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.clock.pauseAt(new Date(Date.now() + 1000))
})

for (const providerId of ['claude', 'codex'] as const) {
  test(`${providerId} shows reasoning and subsequent tools without playback delay`, async ({ page }) => {
    const thinking = 'Inspect the implementation carefully. '.repeat(80)
    const response = message('live', '', {
      providerId,
      content: providerId === 'claude' ? [{ type: 'thinking', thinking }] : [],
      ...(providerId === 'codex' ? { metadata: { codex: {
        threadId: 'live', usage: null, items: [{ id: 'reason', type: 'reasoning', text: thinking }],
      } } } : {}),
    })
    await send(page, { type: 'hydrate', messages: [] })
    await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [response] })
    const article = page.locator('article[data-turn-id="live"]')
    await expect(article.locator('.thinking-content')).toHaveText(thinking)
    if (providerId === 'claude') {
      response.content.push({ type: 'tool_use', toolUseId: 'tool', toolName: 'Bash', input: '{"command":"pwd"}', status: 'streaming' })
    } else {
      response.metadata!.codex!.items.push({ id: 'tool', type: 'command_execution', command: 'cat README.md', commandActions: [{ type: 'read', path: 'README.md', name: 'README.md' }], aggregatedOutput: '', status: 'in_progress' })
    }
    await send(page, { type: 'applyReductionPatch', messages: [response] })
    // The clock remains paused: no simulated playback budget is needed.
    await expect(article.getByText(providerId === 'claude' ? 'pwd' : 'README.md', { exact: true }).first()).toBeVisible()
    await expect(article.locator('.thinking-content')).toHaveCount(0)
    await page.screenshot({ path: `/tmp/superone-live-${providerId}.png` })
    const answer = 'The command has finished. '.repeat(100).trim()
    if (providerId === 'claude') {
      response.content.push({ type: 'tool_result', toolUseId: 'tool', summary: '/project' }, { type: 'text', text: answer })
    } else {
      Object.assign(response.metadata!.codex!.items[1], { status: 'completed', aggregatedOutput: '/project', exitCode: 0 })
      response.metadata!.codex!.items.push({ id: 'answer', type: 'agent_message', text: answer })
    }
    response.status = 'complete'
    await send(page, { type: 'applyReductionPatch', sessionStatus: 'idle', messages: [response] })
    await expect(article.locator('.chat-md')).toHaveText(answer)
  })
}

test('live text uses only the rendering tick and preserves split Markdown', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [] })
  let text = ''
  for (const chunk of ['Hello', ' world', '\n\n```', 'ts\nconst value = 1', '\n```']) {
    text += chunk
    await send(page, { type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [message('text', text)] })
    await page.clock.runFor(34)
    await expect(page.locator('.chat-md')).toContainText(text.includes('const') ? 'const value = 1' : text.includes('world') ? 'Hello world' : 'Hello')
  }
  await expect(page.locator('pre')).toContainText('const value = 1')
  await expect(page.locator('pre span[style]')).not.toHaveCount(0)
})

test('raw insight markers render as a callout', async ({ page }) => {
  const text = '`★ Insight ─────────────────────────────────────`\nKeep raw streaming text intact.\n`─────────────────────────────────────────────────`'
  await send(page, { type: 'applyReductionPatch', sessionStatus: 'idle', messages: [message('insight', text, { status: 'complete' })] })
  await expect(page.getByText('Keep raw streaming text intact.', { exact: true })).toBeVisible()
  await expect(page.locator('[class~="group/insight"]')).toBeVisible()
  await expect(page.locator('article')).not.toContainText('───')
})

test('history, reconnect and reset show authoritative text without replay', async ({ page }) => {
  const history = message('old', 'Earlier history', { status: 'complete' })
  await send(page, { type: 'hydrate', messages: [message('live', 'Current output')] })
  await send(page, { type: 'prependHistory', messages: [history] })
  await send(page, { type: 'setWindow', range: { start: 0, end: 2 } })
  await expect(page.locator('article[data-turn-id="old"]')).toContainText('Earlier history')
  await expect(page.locator('article[data-turn-id="live"]')).toContainText('Current output')
  await send(page, { type: 'hydrate', messages: [message('live', 'Reconnected output', { status: 'complete' })] })
  await expect(page.locator('article[data-turn-id="live"]')).toContainText('Reconnected output')
  await send(page, { type: 'reset' })
  await expect(page.locator('article')).toHaveCount(0)
})
