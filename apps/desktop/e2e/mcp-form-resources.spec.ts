import { test, expect } from '@playwright/test'

const base = process.env.MCP_APPS_STORYBOOK_URL
test.skip(!base, 'Build Storybook and set MCP_APPS_STORYBOOK_URL')
const open = (page: import('@playwright/test').Page, story: string) => page.goto(`${base}/iframe.html?id=tool-ui-general-permission-prompt-schema-form--${story}&viewMode=story`)

test('resource preview and picked files submit through the production composer', async ({ page }) => {
  await open(page, 'native-files-and-preview')
  await expect(page.getByRole('checkbox', { name: /custom-part.stl/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('resource-preview')).toContainText('Material: stainless steel')
  await expect(page.getByTestId('resource-preview')).toContainText('<script>shown as text, never executed</script>')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByTestId('sent')).toContainText('file:///workspace/custom-part.stl')
})

test('preview loading and refusal leave server choices usable', async ({ page }) => {
  await open(page, 'resource-preview-loading')
  await expect(page.getByRole('status')).toContainText('Loading preview')
  await page.getByRole('checkbox', { name: /M6 washer/ }).click()
  await expect(page.getByRole('checkbox', { name: /M6 washer/ })).toHaveAttribute('aria-checked', 'true')
  await open(page, 'native-file-denied')
  await expect(page.getByRole('alert')).toContainText('does not match')
  await page.getByRole('checkbox', { name: /M6 washer/ }).click()
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByTestId('sent')).toContainText('cad://parts/washer')
})

test('implicit removal returns remaining items and a directory uses single selection', async ({ page }) => {
  await open(page, 'native-implicit-resources')
  await expect(page.getByTestId('sent')).toContainText('cad://parts/hex-bolt')
  await expect(page.getByTestId('sent')).not.toContainText('cad://parts/washer')
  await open(page, 'native-directory')
  await page.getByRole('button', { name: 'Add folder…' }).click()
  await expect(page.getByRole('radio', { name: /cad-parts/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByTestId('sent')).toContainText('file:///workspace/cad-parts')
})

test('expanded previews and added files fit a narrow permission card', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await open(page, 'native-resources-narrow')
  await expect(page.getByRole('checkbox', { name: /custom-part.stl/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('resource-preview')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
