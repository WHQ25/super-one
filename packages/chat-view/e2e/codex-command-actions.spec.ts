import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function open(page: Page, deferred: boolean, mixed = false, options: { retry?: boolean; locale?: string; light?: boolean; metadata?: boolean } = {}) {
  const command = mixed ? 'cat a.ts && rg TODO src' : 'head -n 20 a.ts b.ts'
  const commandActions = mixed
    ? [{ type: 'read', path: '/repo/a.ts' }, { type: 'search', command: 'rg TODO src', query: 'TODO', path: '/repo/src' }]
    : [{ type: 'read', command, path: '/repo/a.ts' }]
  await page.setViewportSize({ width: 320, height: 780 })
  await page.addInitScript(({ command, retry, metadata }) => {
    const host = window as unknown as { ReactNativeWebView: { postMessage(raw: string): void }; __applyHost(value: unknown): void; requests: { action: string; payload: unknown }[] }
    host.requests = []
    let attempts = 0
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      host.requests.push(request)
      if (request.action === 'subscribeDetail' && retry && attempts++ === 0) {
        host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId, error: 'Unable to load output' }); return
      }
      if (request.action === 'subscribeDetail') host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId, result: {
        subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0,
        text: JSON.stringify({ input: JSON.stringify({ command }), result: 'combined command output',
          ...(metadata ? { item: { id: 'command', type: 'command_execution', command, cwd: '/repo', status: 'completed',
            exitCode: 0, aggregatedOutput: '', commandActions: [{ type: 'read', path: '/repo/a.ts' }] } } : {}) }),
      } })
    } }
  }, { command, retry: options.retry, metadata: options.metadata })
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate(({ command, commandActions, deferred, options }) => {
    const host = window as unknown as { __applyHost(value: unknown): void }
    host.__applyHost({ type: 'channelToken', token: 'command-test' })
    host.__applyHost({ type: 'setTheme', scheme: options.light ? 'light' : 'dark' })
    if (options.locale) host.__applyHost({ type: 'setViewport', locale: options.locale })
    host.__applyHost({ type: 'hydrate', sessionStatus: 'idle', messages: [{
      id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: [{
        id: 'command', type: 'command_execution', command, cwd: '/repo', commandActions,
        status: 'completed', exitCode: 0, aggregatedOutput: deferred ? '' : 'combined command output',
        ...(deferred ? { remoteDetail: '["turn","item","command"]' } : {}),
      }] } },
    }] })
  }, { command, commandActions, deferred, options })
  return page.locator('[data-tool-use-id="command"]')
}

for (const mode of ['full', 'deferred', 'deferred metadata'] as const) {
  test(`multiple reads share one command container and one output (${mode})`, async ({ page }) => {
    const deferred = mode !== 'full'
    const row = await open(page, deferred, false, { metadata: mode === 'deferred metadata' })
    await expect(row).toContainText('2 files')
    await row.getByText('Read', { exact: true }).first().click()
    await expect(row.getByText('a.ts', { exact: true })).toBeVisible()
    await expect(row.getByText('b.ts', { exact: true })).toBeVisible()
    await expect(row.locator('.bg-terminal-bg')).toHaveCount(0)
    await row.getByText('b.ts', { exact: true }).click()
    expect(await page.evaluate(() => (window as unknown as { requests: { action: string; payload: unknown }[] }).requests.filter(r => r.action === 'previewFile').at(-1)?.payload)).toEqual({ path: '/repo/b.ts' })
    await row.getByText('Command', { exact: true }).click()
    await expect(row.locator('.text-terminal-muted')).toContainText('combined command output')
    expect((await row.innerText()).match(/combined command output/g)).toHaveLength(1)
    expect((await row.innerText()).match(/Exit code 0/g)).toHaveLength(1)
    await expect(page.locator('[data-tool-use-id="command"]')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    if (mode === 'deferred metadata') await row.screenshot({ path: '/tmp/superone-codex-multi-read.png' })
  })
}

test('mixed read/search actions are all visible inside one exploration call', async ({ page }) => {
  const row = await open(page, true, true)
  await row.getByText('Code Explored', { exact: true }).click()
  await expect(row.getByText('a.ts', { exact: true })).toBeVisible()
  await expect(row.getByText('Grep', { exact: true })).toBeVisible()
  await expect(row).toContainText('TODO')
})

test('deferred output failure and retry remain visible alongside the file rows', async ({ page }) => {
  const row = await open(page, true, false, { retry: true })
  await row.getByText('Read', { exact: true }).first().click()
  await expect(row.getByRole('status')).toContainText('Unable to load output')
  await expect(row.getByText('b.ts', { exact: true })).toBeVisible()
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(row.getByRole('status')).toHaveCount(0)
  await row.getByRole('button', { name: 'Command', exact: true }).click()
  await expect(row.locator('.text-terminal-muted')).toContainText('combined command output')
})

test('Chinese light layout retains the count and both file rows at 320px', async ({ page }) => {
  const row = await open(page, false, false, { locale: 'zh', light: true })
  await expect(row).toContainText('2 个文件')
  await row.getByText('Read', { exact: true }).first().click()
  await expect(row.getByText('a.ts', { exact: true })).toBeVisible()
  await expect(row.getByText('b.ts', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: '命令', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})

test('exploration group counts unique file paths across all actions and calls', async ({ page }) => {
  await open(page, false)
  await page.evaluate(() => {
    const host = window as unknown as { __applyHost(value: unknown): void }
    const base = { type: 'command_execution', command: 'opaque', status: 'completed', exitCode: 0, aggregatedOutput: '' }
    host.__applyHost({ type: 'hydrate', sessionStatus: 'idle', messages: [{
      id: 'group-turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: [
        { ...base, id: 'read-1', commandActions: [{ type: 'read', path: '/repo/a/index.ts' }, { type: 'read', path: '/repo/b/index.ts' }] },
        { ...base, id: 'read-2', commandActions: [{ type: 'read', path: '/repo/a/index.ts' }] },
      ] } },
    }] })
  })
  const group = page.getByRole('button', { name: 'Read 2 files', exact: true })
  await expect(group).toBeVisible()
  await group.click()
  await expect(page.locator('[data-tool-use-id="read-1"]')).toContainText('2 files')
  await expect(page.locator('[data-tool-use-id="read-2"]')).toContainText('index.ts')
})
