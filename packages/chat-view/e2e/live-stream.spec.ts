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
    await expect(article.locator('.thinking-content')).toHaveCount(0)
    await article.locator('.thinking-node > div').first().click()
    await expect(article.locator('.thinking-content')).toHaveText(thinking)
    if (providerId === 'claude') {
      response.content.push({ type: 'tool_use', toolUseId: 'tool', toolName: 'Bash', input: '{"command":"pwd"}', status: 'streaming' })
    } else {
      response.metadata!.codex!.items.push({ id: 'tool', type: 'command_execution', command: 'cat README.md', commandActions: [{ type: 'read', path: 'README.md', name: 'README.md' }], aggregatedOutput: '', status: 'in_progress' })
    }
    await send(page, { type: 'applyReductionPatch', messages: [response] })
    // The clock remains paused: no simulated playback budget is needed.
    await expect(article.getByText(providerId === 'claude' ? 'pwd' : 'README.md', { exact: true }).first()).toBeVisible()
    await expect(article.locator('.thinking-content')).toHaveText(thinking)
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

test('reasoning subscribes on click, bridges snapshot races, and unsubscribes on collapse', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(globalThis, { requests: [], ReactNativeWebView: { postMessage(raw: string) {
      const request = JSON.parse(raw)
      ;(globalThis as any).requests.push(request)
      if (request.action === 'subscribeDetail') {
        const update = { subscriptionId: request.payload.subscriptionId, offset: 3, text: 'def', revision: 1 }
        ;(globalThis as any).__applyHost({ type: 'detailUpdate', ...update })
        ;(globalThis as any).__applyHost({ type: 'nativeActionResult', requestId: request.requestId,
          result: { subscriptionId: request.payload.subscriptionId, offset: 0, text: 'abc', revision: 0 } })
      }
    } } })
  })
  await send(page, { type: 'hydrate', sessionStatus: 'streaming', messages: [message('deferred', '', {
    content: [{ type: 'thinking', thinking: '', remoteDetail: '["deferred","thinking",0]' }],
  })] })
  const article = page.locator('article[data-turn-id="deferred"]')
  await expect(article.locator('.thinking-content')).toHaveCount(0)
  expect(await page.evaluate(() => (globalThis as any).requests.filter((request: any) => request.action === 'subscribeDetail'))).toHaveLength(0)
  await article.locator('.thinking-node > div').first().click()
  await expect(article.locator('.thinking-content')).toHaveText('abcdef')
  await article.locator('.thinking-node > div').first().click()
  await expect(article.locator('.thinking-content')).toHaveCount(0)
  await page.clock.runFor(34)
  await expect.poll(() => page.evaluate(() => (globalThis as any).requests.filter((request: any) => request.action === 'unsubscribeDetail').length)).toBe(1)
})

test('older history loads only on demand and reveals the fetched page', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(globalThis, { requests: [], ReactNativeWebView: { postMessage(raw: string) {
      const request = JSON.parse(raw)
      ;(globalThis as any).requests.push(request)
      if (request.action === 'loadEarlier') (globalThis as any).__applyHost({ type: 'nativeActionResult', requestId: request.requestId,
        result: { hasMoreHistory: false, messages: [{ id: 'older', role: 'user', status: 'complete', providerId: 'claude', createdAt: '', content: [{ type: 'text', text: 'Older question' }] }] } })
    } } })
  })
  await send(page, { type: 'hydrate', hasMoreHistory: true, messages: [message('latest', 'Latest answer', { status: 'complete' })] })
  await expect(page.getByRole('button', { name: 'Load earlier' })).toBeVisible()
  await page.getByRole('button', { name: 'Load earlier' }).click()
  await expect(page.locator('article[data-turn-id="older"]')).toContainText('Older question')
  await expect(page.locator('article[data-turn-id="latest"]')).toContainText('Latest answer')
})

test('tool shell fetches full output on expansion and reuses completed cache', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(globalThis, { requests: [], ReactNativeWebView: { postMessage(raw: string) {
      const request = JSON.parse(raw)
      ;(globalThis as any).requests.push(request)
      if (request.action === 'subscribeDetail') (globalThis as any).__applyHost({ type: 'nativeActionResult', requestId: request.requestId,
        result: { subscriptionId: request.payload.subscriptionId, offset: 0, revision: 0, text: JSON.stringify({ input: '{"file_path":"a.txt"}', result: 'Full file content loaded on demand' }) } })
    } } })
  })
  await send(page, { type: 'hydrate', messages: [message('tool-detail', '', { status: 'complete', content: [
    { type: 'tool_use', toolUseId: 'read', toolName: 'Read', input: '{"file_path":"a.txt"}', status: 'complete', remoteDetail: '["tool-detail","tool","read"]' },
    { type: 'tool_result', toolUseId: 'read', summary: '' },
  ] })] })
  const article = page.locator('article[data-turn-id="tool-detail"]')
  await expect(article).not.toContainText('Full file content')
  await article.getByText('Read', { exact: true }).click()
  await expect(article).toContainText('Full file content loaded on demand')
  await page.clock.runFor(250)
  await page.screenshot({ path: '/tmp/superone-progressive-tool.png', animations: 'disabled' })
  await expect(article.getByText('Full file content loaded on demand', { exact: true })).toBeVisible()
  await article.getByText('Read', { exact: true }).click()
  await page.clock.runFor(34)
  await article.getByText('Read', { exact: true }).click()
  await expect(article).toContainText('Full file content loaded on demand')
  expect(await page.evaluate(() => (globalThis as any).requests.filter((request: any) => request.action === 'subscribeDetail'))).toHaveLength(1)
})

test('deferred subagent renders one card and loads its child rows on expansion', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(globalThis, { requests: [], ReactNativeWebView: { postMessage(raw: string) {
      const request = JSON.parse(raw)
      ;(globalThis as any).requests.push(request)
      if (request.action === 'subscribeDetail') (globalThis as any).__applyHost({ type: 'nativeActionResult', requestId: request.requestId,
        result: { subscriptionId: request.payload.subscriptionId, offset: 0, revision: 0, text: JSON.stringify({
          input: JSON.stringify({ subagent_type: 'explore', description: 'Explore mobile image click flow', prompt: 'Find every image tap handler.' }),
          result: 'Found three handlers.',
          childBlocks: [
            { type: 'tool_use', toolUseId: 'child-grep', toolName: 'Grep', input: '{"pattern":"onPress"}', status: 'complete', parentToolUseId: 'task', remoteDetail: '["subagent-detail","tool","child-grep"]' },
            { type: 'tool_result', toolUseId: 'child-grep', summary: '', parentToolUseId: 'task' },
          ],
        }) } })
    } } })
  })
  // Prompt pushed the projected input past the size cap: only `toolSummary` names the task.
  await send(page, { type: 'hydrate', messages: [message('subagent-detail', '', { status: 'complete', content: [
    { type: 'tool_use', toolUseId: 'task', toolName: 'Task', input: '{}', status: 'complete',
      toolSummary: 'Explore mobile image click flow', remoteDetail: '["subagent-detail","tool","task"]' },
    { type: 'tool_result', toolUseId: 'task', summary: '' },
  ] })] })
  const article = page.locator('article[data-turn-id="subagent-detail"]')
  const card = article.locator('.subagent-container')
  // One subagent card, not a generic tool row wrapping a second header.
  await expect(card).toHaveCount(1)
  await expect(article.locator('.tool-node')).toHaveCount(0)
  await expect(card).toContainText('Explore mobile image click flow')
  expect(await page.evaluate(() => (globalThis as any).requests.filter((request: any) => request.action === 'subscribeDetail'))).toHaveLength(0)
  await card.locator('> button').click()
  await expect(card).toContainText('explore')
  await expect(card.locator('[data-tool-use-id="child-grep"]')).toBeVisible()
  expect(await page.evaluate(() => (globalThis as any).requests.filter((request: any) => request.action === 'subscribeDetail'))).toHaveLength(1)
  await expect(card).toHaveCount(1)
})

test('edit header shows line delta before expansion and hides raw params after', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(globalThis, { ReactNativeWebView: { postMessage(raw: string) {
      const request = JSON.parse(raw)
      if (request.action === 'subscribeDetail') (globalThis as any).__applyHost({ type: 'nativeActionResult', requestId: request.requestId,
        result: { subscriptionId: request.payload.subscriptionId, offset: 0, revision: 0, text: JSON.stringify({
          input: '{"file_path":"config.ts"}',
          toolDiff: '-const previewEnabled = false\n+const previewEnabled = true',
          toolLineDelta: { added: 1, removed: 1 },
        }) } })
    } } })
  })
  await send(page, { type: 'hydrate', messages: [message('edit-detail', '', { status: 'complete', content: [
    { type: 'tool_use', toolUseId: 'edit', toolName: 'Edit', input: '{"file_path":"config.ts"}', status: 'complete',
      toolLineDelta: { added: 1, removed: 1 }, remoteDetail: '["edit-detail","tool","edit"]' },
    { type: 'tool_result', toolUseId: 'edit', summary: 'Applied 1 edit.' },
  ] })] })
  const article = page.locator('article[data-turn-id="edit-detail"]')
  await expect(article).toContainText('+1')
  await expect(article).toContainText('-1')
  await expect(article).not.toContainText('old_string')
  await expect(article).not.toContainText('previewEnabled')
  await article.getByText('Edit', { exact: true }).click()
  await expect(article).toContainText('const previewEnabled = true')
  await expect(article).not.toContainText('old_string')
})

test('applies changed rows without resending history or losing ordering', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: [message('old', 'History'), message('live', 'Before')] })
  await send(page, { type: 'applyReductionPatch', messagePatches: [message('live', 'After')] })
  await expect(page.locator('article[data-turn-id="old"]')).toContainText('History')
  await expect(page.locator('article[data-turn-id="live"]')).toContainText('After')
  await send(page, { type: 'applyReductionPatch', messagePatches: [], messageOrder: ['live'] })
  await expect(page.locator('article')).toHaveCount(1)
})
