import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '@superone/shared/agent-types'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const raw = 'The request failed before the response finished. Please try again. '
  + 'Diagnostic details: '.repeat(12) + 'request_' + 'a'.repeat(120)

for (const provider of ['codex', 'claude'] as const) {
  for (const { width, scheme, fontScale } of [
    { width: 320, scheme: 'dark', fontScale: 1 },
    { width: 390, scheme: 'light', fontScale: 1 },
    { width: 320, scheme: 'dark', fontScale: 1.6 },
  ]) {
    test(`${provider} error popover fits a ${width}px ${scheme} phone at ${fontScale}x with usage visible`, async ({ page }, testInfo) => {
      await page.context().setOffline(true)
      await page.setViewportSize({ width, height: 844 })
      await page.addInitScript(() => {
        const copiedErrors: string[] = []
        Object.assign(globalThis, {
          copiedErrors,
          ReactNativeWebView: { postMessage(serialized: string) {
            const request = JSON.parse(serialized)
            if (request.type === 'requestNative' && request.action === 'copyText') copiedErrors.push(request.payload.text)
          } },
        })
      })
      await page.goto(documentUrl)
      await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
      const message: ChatMessage = {
        id: 'failed-turn', role: 'assistant', status: 'error', providerId: provider,
        createdAt: '2026-09-14T00:00:00.000Z',
        content: [
          { type: 'text', text: 'I checked the implementation before the request failed.' },
          { type: 'notice', id: 'error-notice', level: 'error', text: raw },
        ],
        metadata: {
          durationMs: 45_000,
          consumedTokens: { input: 18_400, output: 2_600 },
          errorInfo: {
            raw,
            code: provider === 'codex' ? 'cyberPolicy' : 'rate_limit',
            httpStatus: provider === 'claude' ? 429 : undefined,
            terminalReason: 'api_error',
            subtype: 'success',
            model: '<synthetic>',
            requestId: 'req_' + 'a'.repeat(120),
          },
          ...(provider === 'codex' ? { codex: { threadId: 'thread', usage: null, items: [] } } : {}),
        },
      }
      await page.evaluate(({ message: value, scheme, fontScale }) => {
        const target = globalThis as typeof globalThis & { __applyHost: (message: unknown) => void }
        target.__applyHost({ type: 'channelToken', token: 'turn-error-test' })
        target.__applyHost({ type: 'setTheme', scheme, fontScale })
        target.__applyHost({ type: 'hydrate', sessionStatus: 'idle', messages: [value] })
      }, { message, scheme, fontScale })

      const turn = page.locator('article[data-turn-id="failed-turn"]')
      const button = turn.getByRole('button', { name: provider === 'codex' ? 'Request Failed' : 'Usage Limit Reached' })
      const rawText = page.getByText(raw, { exact: true })
      await expect(rawText).toHaveCount(0)
      expect(await button.evaluate(element => getComputedStyle(element).color))
        .toBe(await turn.getByText('18.4k', { exact: true }).evaluate(element => getComputedStyle(element).color))
      await page.screenshot({ path: testInfo.outputPath('collapsed-error.png') })
      const turnBounds = await turn.boundingBox()
      await button.click()
      const popover = page.getByRole('dialog')
      await expect(popover).toBeVisible()
      if (provider === 'claude') {
        await expect(rawText).toHaveCount(0)
        await popover.getByRole('button', { name: 'Error Details' }).click()
      }
      await expect(rawText).toBeVisible()
      await expect(turn.getByText(raw, { exact: true })).toHaveCount(0)
      await expect(turn).toContainText('18.4k')
      await expect(turn).toContainText('2.6k')
      expect((await turn.boundingBox())!.height).toBeCloseTo(turnBounds!.height, 0)
      const panel = rawText.locator('..')
      const popoverBounds = await popover.boundingBox()
      expect(popoverBounds!.x).toBeGreaterThanOrEqual(0)
      expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(width)
      const label = panel.getByText('terminal_reason', { exact: true })
      const labelLayout = await label.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return {
          textRight: range.getBoundingClientRect().right,
          cellRight: element.getBoundingClientRect().right,
          valueLeft: element.nextElementSibling!.getBoundingClientRect().left,
        }
      })
      expect(labelLayout.textRight).toBeLessThanOrEqual(labelLayout.cellRight + 1)
      expect(labelLayout.valueLeft - labelLayout.textRight).toBeGreaterThanOrEqual(7)
      expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath('expanded-error.png') })
      await popover.getByRole('button', { name: 'Copy', exact: true }).click()
      const copied = await page.evaluate(() => (globalThis as typeof globalThis & { copiedErrors: string[] }).copiedErrors)
      expect(copied).toHaveLength(1)
      expect(copied[0]).toContain(raw)
      expect(copied[0]).toContain(message.metadata!.errorInfo!.requestId)
      expect(copied[0]).toContain('terminal_reason')
      await page.keyboard.press('Escape')
      await expect(rawText).toHaveCount(0)
      await expect(button).toBeFocused()
    })
  }
}
