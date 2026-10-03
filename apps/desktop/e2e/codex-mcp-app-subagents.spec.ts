import { test, expect } from '@playwright/test'

const base = process.env.MCP_APPS_STORYBOOK_URL
test.skip(!base, 'Build Storybook and set MCP_APPS_STORYBOOK_URL')
const open = (page: import('@playwright/test').Page, story: string) => page.goto(`${base}/iframe.html?id=tool-ui-codex-subagent-mcp-apps--${story}&viewMode=story`)

test('a child App initializes and calls a tool through the same View document', async ({ page }) => {
  await open(page, 'live')
  const view = page.frameLocator('iframe[data-mcp-app-frame]')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  const source = await page.locator('iframe[data-mcp-app-frame]').getAttribute('src')
  await view.getByRole('button', { name: 'Next page' }).click()
  await expect(view.locator('#status')).toHaveText('page 2/4')
  expect(await page.locator('iframe[data-mcp-app-frame]').getAttribute('src')).toBe(source)
})

test('a restored child snapshot requires Activate before a tool call', async ({ page }) => {
  await open(page, 'restored')
  await page.locator('[data-embedded-tool-toggle]').click()
  const view = page.frameLocator('iframe[data-mcp-app-frame]')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await view.getByRole('button', { name: 'Next page' }).click()
  await expect(view.locator('#log')).toContainText('Activate this restored')
  await page.getByRole('button', { name: 'Activate', exact: true }).click()
  await view.getByRole('button', { name: 'Next page' }).click()
  await expect(view.locator('#status')).toHaveText('page 2/4')
})

test('child loading and retry states remain actionable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await open(page, 'loading')
  await expect(page.locator('[data-mcp-app-state-card]')).toBeVisible()
  await open(page, 'error-retry')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.frameLocator('iframe[data-mcp-app-frame]').locator('#status')).toHaveText('page 1/4')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
