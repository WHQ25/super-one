import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { rm } from 'node:fs/promises'

const PROJECT_ROOT = process.cwd()
const MAIN_ENTRY = path.join(PROJECT_ROOT, 'out/main/index.js')
const INSTANCE_NAME = 'playwright'
const USER_DATA_DIR = path.join(PROJECT_ROOT, '.dev-data', `instance-${INSTANCE_NAME}`)

async function getRendererWindow(app: ElectronApplication, timeoutMs = 15_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => !w.url().startsWith('devtools://'))
    if (win) {
      await win.waitForLoadState('domcontentloaded')
      return win
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`renderer window did not open within ${timeoutMs}ms`)
}

test.describe('app launch', () => {
  let app: ElectronApplication

  test.beforeAll(async () => {
    await rm(USER_DATA_DIR, { recursive: true, force: true })
    app = await electron.launch({
      args: [MAIN_ENTRY],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        SUPERONE_INSTANCE: INSTANCE_NAME,
        SUPERONE_E2E: '1',
        NODE_ENV: 'development',
      },
    })
    await app.firstWindow()
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('renderer window opens, body renders, and main process is non-packaged', async () => {
    const window = await getRendererWindow(app)

    const isPackaged = await app.evaluate(({ app }) => app.isPackaged)
    expect(isPackaged).toBe(false)

    await expect(window.locator('body')).toBeVisible()

    await window.screenshot({
      path: path.join(PROJECT_ROOT, 'e2e/.artifacts/launch-first-window.png'),
      fullPage: true,
    })

    const url = window.url()
    const title = await window.title()
    console.log('[e2e] renderer.url   =', url)
    console.log('[e2e] renderer.title =', JSON.stringify(title))
    console.log('[e2e] app.isPackaged =', isPackaged)
    console.log('[e2e] userData       =', USER_DATA_DIR)

    expect(url).not.toMatch(/^devtools:/)

    const devtoolsWindows = app.windows().filter((w) => w.url().startsWith('devtools://'))
    expect(devtoolsWindows, 'SUPERONE_E2E should suppress auto-opened DevTools').toHaveLength(0)
  })
})
