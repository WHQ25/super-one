import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
import { DESKTOP_ROOT as PROJECT_ROOT, getRendererWindow, instanceUserDataDir, removeInstanceData } from './fixtures/desktop-instance'

const INSTANCE_NAME = 'playwright'
const USER_DATA_DIR = instanceUserDataDir(INSTANCE_NAME)

test.describe('app launch', () => {
  let app: ElectronApplication

  test.beforeAll(async () => {
    await removeInstanceData(INSTANCE_NAME)
    app = await electron.launch({
      // `.` boots through package.json `main`, the same entry the packaged app uses.
      args: ['.'],
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
