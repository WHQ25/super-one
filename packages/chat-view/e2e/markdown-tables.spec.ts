import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { HostInbound } from '../src/protocol'

/**
 * Tables in the **built** document, not in a story.
 *
 * Storybook renders chat-view's sources through the desktop's CSS pipeline, so it
 * proves the components work and nothing about what ships. The phone loads
 * `dist/index.html`, whose stylesheet is chat-view's own build — and `chat-md.css`
 * only started being imported there in September, so a mobile app built before that
 * produced correct `<table>` markup with none of the rules that make it legible.
 * That failure is invisible to every test that does not load this document.
 */
const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const clockStart = new Date('2026-09-08T00:00:00.000Z')

const TABLE = [
  'Where each tool renders:',
  '',
  '| Tool | Desktop | Mobile |',
  '| --- | --- | --- |',
  '| widget_show | WidgetBlock | portable frame |',
  '| config_read | compact row | compact row |',
  '',
  'Both surfaces share the descriptor table.',
].join('\n')

function message(id: string, text: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: clockStart.toISOString(),
    providerId: 'claude',
  }
}

async function send(page: Page, envelope: HostInbound): Promise<void> {
  await page.evaluate((value) => {
    const target = globalThis as typeof globalThis & { __applyHost?: (message: unknown) => void }
    if (!target.__applyHost) throw new Error('Chat host bridge is unavailable')
    target.__applyHost(value)
  }, envelope)
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
  // A phone, because a table is the one construct whose failure mode is width.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000))
  await send(page, { type: 'hydrate', sessionStatus: 'idle', messages: [message('table', TABLE)] })
})

test('renders a markdown table as a table, with its prose intact', async ({ page }) => {
  const table = page.locator('article[data-turn-id="table"] table')
  await expect(table).toBeVisible()
  await expect(table.locator('thead th')).toHaveCount(3)
  await expect(table.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('article[data-turn-id="table"]')).toContainText('Both surfaces share')
})

test('carries the stylesheet that makes the table legible', async ({ page }) => {
  // The exact regression: correct markup, no `chat-md.css`. Cell borders and the
  // header fill are what separate a table from a run-together wall of words, so they
  // are what the assertion names.
  const cell = page.locator('article[data-turn-id="table"] tbody td').first()
  const header = page.locator('article[data-turn-id="table"] thead th').first()

  await expect(cell).toHaveCSS('border-bottom-style', 'solid')
  expect(await cell.evaluate((node) => getComputedStyle(node).paddingLeft)).not.toBe('0px')

  const headerFill = await header.evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(headerFill).not.toBe('rgba(0, 0, 0, 0)')
})

test('keeps a wide table inside the phone rather than stretching the transcript', async ({ page }) => {
  await send(page, {
    type: 'hydrate',
    sessionStatus: 'idle',
    messages: [message('wide', [
      '| Tool | Desktop presenter | Mobile presenter | Projection fields | Notes |',
      '| --- | --- | --- | --- | --- |',
      '| widget_show | WidgetBlock | PortableWidgetBlock | widget_code kept whole | sandboxed iframe |',
    ].join('\n'))],
  })

  const table = page.locator('article[data-turn-id="wide"] table')
  await expect(table).toBeVisible()

  // The table may scroll sideways in its own wrapper; the document may not, or the
  // whole transcript shifts under the reader's thumb.
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(documentWidth).toBeLessThanOrEqual(390)
})
