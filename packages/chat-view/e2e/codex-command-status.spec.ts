import { expect, test } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

for (const deferred of [false, true]) test(`non-zero command exit stays normal before and after expansion (deferred: ${deferred})`, async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      ReactNativeWebView: { postMessage(raw: string): void }
      __applyHost(value: unknown): void
    }
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.action !== 'subscribeDetail') return
      host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId, result: {
        subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0,
        text: JSON.stringify({ input: JSON.stringify({ command: 'bun run test' }), result: 'One assertion failed' }),
      } })
    } }
  })
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.evaluate((deferred) => {
    (window as unknown as { __applyHost(value: unknown): void }).__applyHost({
      type: 'hydrate', messages: [{
        id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
        metadata: { codex: { threadId: 'thread', usage: null, items: [{
          id: 'command', type: 'command_execution', command: 'bun run test', status: 'failed', exitCode: 1,
          aggregatedOutput: deferred ? '' : 'One assertion failed',
          ...(deferred ? { remoteDetail: '["turn","item","command"]' } : {}),
        }] } },
      }],
    })
  }, deferred)
  const row = page.locator('[data-tool-use-id="command"]')
  await expect(row).toContainText('bun run test')
  await expect(row).not.toHaveClass(/errored/)
  await row.getByText('bun run test', { exact: true }).click()
  await expect(row).toContainText('One assertion failed')
  await expect(row).not.toHaveClass(/errored/)
  await page.screenshot({ path: `/tmp/codex-command-${deferred ? 'deferred' : 'full'}.png` })
})
