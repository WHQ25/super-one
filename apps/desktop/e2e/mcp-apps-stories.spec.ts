import { test, expect } from '@playwright/test'
const base = process.env.MCP_APPS_STORYBOOK_URL
test.skip(!base, 'Start the development Storybook and set MCP_APPS_STORYBOOK_URL')
async function open(page: import('@playwright/test').Page, story: string) {
  await page.goto(`${base}/iframe.html?id=chat-mcp-apps--${story}&viewMode=story`)
  return page.frameLocator('iframe[data-mcp-app-frame]')
}
test('live App initializes, directly dispatches a View call and updates the same document', async ({ page }) => {
  const view = await open(page, 'live')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  const src = await page.locator('iframe[data-mcp-app-frame]').getAttribute('src')
  await view.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(view.locator('#status')).toHaveText('page 2/4')
  expect(await page.locator('iframe[data-mcp-app-frame]').getAttribute('src')).toBe(src)
})
test('restored snapshot paints and gates calls until Activate', async ({ page }) => {
  const view = await open(page, 'restored-inactive')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await view.getByRole('button', { name: 'Next page' }).click()
  await expect(view.locator('#log')).toContainText('Activate this restored')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-mcp-app-activate]')).toHaveAttribute('data-emphasized', 'true')
  await page.getByRole('button', { name: 'Activate', exact: true }).click()
  await view.getByRole('button', { name: 'Next page' }).click()
  await expect(view.locator('#status')).toHaveText('page 2/4')
})
test('auth, loading retry and missing snapshot remain actionable', async ({ page }) => {
  let view = await open(page, 'auth-required')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(view.locator('#status')).toHaveText('page 1/4')
  view = await open(page, 'error-retry')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(view.locator('#status')).toHaveText('page 1/4')
  view = await open(page, 'restored-without-snapshot')
  await expect(page.locator('iframe[data-mcp-app-frame]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Activate', exact: true }).click()
  await expect(view.locator('#status')).toHaveText('page 1/4')
})
test('unknown and revoked states do not replay a mutation', async ({ page }) => {
  await open(page, 'unknown-outcome')
  await expect(page.getByText('The tool may have completed', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  const view = await open(page, 'revoked-restart')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await page.getByRole('button', { name: 'Simulate Navigation' }).click()
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeVisible()
  await expect(page.locator('[data-mcp-app-surface]')).toBeHidden()
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(view.locator('#status')).toHaveText('page 1/4')
})
test('narrow and long content fit in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  for (const story of ['narrow', 'long-content', 'light', 'dark']) {
    const view = await open(page, story)
    await expect(view.locator('#status')).toHaveText('page 1/4')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('[data-mcp-app-surface]').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(600)
  }
})
test('View requests fullscreen/PiP modes and keeps iframe identity, state and bridge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const view = await open(page, 'display-modes')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await page.locator('iframe[data-mcp-app-frame]').evaluate(el => { el.dataset.testIdentity = 'original' })
  await view.locator('#fullscreen').click()
  await expect(page.locator('[data-mcp-app-fullscreen]')).toBeVisible()
  await expect(view.locator('#log')).toContainText('"mode":"fullscreen"')
  await expect(page.locator('iframe[data-mcp-app-frame]')).toHaveAttribute('data-test-identity', 'original')
  await view.locator('#pip').click()
  await expect(page.locator('[data-mcp-app-pip]')).toBeVisible()
  await expect(view.locator('#log')).toContainText('"mode":"pip"')
  await expect(page.locator('iframe[data-mcp-app-frame]')).toHaveAttribute('data-test-identity', 'original')
  await page.locator('[data-mcp-app-pip]').getByRole('button', { name: 'Return to Chat' }).click()
  await expect(page.locator('[data-mcp-app-pip]')).toHaveCount(0)
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await expect(page.locator('iframe[data-mcp-app-frame]')).toHaveAttribute('data-test-identity', 'original')
  await view.locator('#next').click()
  await expect(view.locator('#status')).toHaveText('page 2/4')
})

test('a hidden-mounted inline View keeps normal-flow geometry when visibility resumes', async ({ page }) => {
  // Native visibility under the automation driver is always visible on macOS;
  // control the visibility signal to reproduce the suspended layout hook.
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !(window as unknown as { mcpVisible?: boolean }).mcpVisible })
  })
  const view = await open(page, 'live')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await expect(page.locator('[data-mcp-app-surface]')).toBeVisible()
  await page.evaluate(() => { (window as unknown as { mcpVisible: boolean }).mcpVisible = true; document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.locator('[data-mcp-app-surface]')).toBeVisible()
  expect(await page.locator('[data-mcp-app-surface]').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(0)
})

test('inline scroll stays aligned and available Views share the widget hover header', async ({ page }) => {
  const view = await open(page, 'scrolling-transcript')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  const differences = await page.evaluate(async () => {
    const transcript = document.querySelector<HTMLElement>('[data-mcp-transcript]')!
    const iframe = document.querySelector<HTMLIFrameElement>('[data-mcp-app-frame]')!
    const row = document.querySelector<HTMLElement>('[data-mcp-app-surface]')!
    const errors: number[] = []
    for (const top of [10, 60, 150, 260, 0]) {
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        transcript.scrollTop = top
        const frame = iframe.getBoundingClientRect(), slot = row.getBoundingClientRect()
        errors.push(Math.abs(frame.top - slot.top), Math.abs(frame.left - slot.left), Math.abs(frame.width - slot.width))
        resolve()
      }))
    }
    return errors
  })
  expect(Math.max(...differences)).toBe(0)
  await expect(page.locator('[data-app-mcp-row] .tool-node')).toHaveCount(0)
  await expect(page.locator('[data-app-mcp-row] [data-embedded-tool-header]')).toContainText('MCP Apps Fixture · fixture list items')
  await expect(page.locator('[data-comparison-widget] [data-embedded-tool-header]')).toContainText('Widget comparison')
})

 test('loading/auth/error use the ordinary MCP row with one inline action', async ({ page }) => {
  for (const [story, action] of [['loading', null], ['auth-required', 'Sign In'], ['error-retry', 'Retry'], ['restored-without-snapshot', 'Activate']] as const) {
    await open(page, story)
    const row = page.locator('[data-app-mcp-row] .tool-node')
    await expect(row).toBeVisible()
    await expect(row).toContainText('fixture list items')
    if (action) await expect(row.getByRole('button', { name: action, exact: true })).toBeVisible()
    await expect(page.locator('[data-app-mcp-row] [data-embedded-tool-header]')).toBeHidden()
  }
})
 test('details toggle without hiding or replacing the View, fullscreen exit preserves the bridge', async ({ page }) => {
  const view = await open(page, 'live')
  await expect(view.locator('#status')).toHaveText('page 1/4')
  await page.locator('iframe[data-mcp-app-frame]').evaluate(el => { el.dataset.testIdentity = 'original' })
  await page.locator('[data-app-mcp-row]').hover()
  const details = page.locator('[data-app-mcp-row] [data-embedded-tool-header] button')
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await view.locator('#fullscreen').click()
  await expect(page.locator('[data-mcp-app-fullscreen]')).toBeVisible()
  await page.getByRole('button', { name: 'Exit Full Screen', exact: true }).click()
  await expect(page.locator('[data-mcp-app-fullscreen]')).toHaveCount(0)
  await expect(page.locator('iframe[data-mcp-app-frame]')).toHaveAttribute('data-test-identity', 'original')
  await view.locator('#next').click()
  await expect(view.locator('#status')).toHaveText('page 2/4')
})
