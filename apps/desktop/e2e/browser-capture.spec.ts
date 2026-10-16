import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {} from './fixtures/browser-capture-host'

test.describe('native browser selector screenshots', () => {
  let app: ElectronApplication
  let page: Page
  let temporary: string

  test.beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'superone-browser-capture-'))
    await mkdir(join(temporary, 'profile'))
    for (const target of ['main', 'host']) {
      execFileSync('bun', ['build', resolve(`e2e/fixtures/browser-capture-${target}.ts`),
        '--target', target === 'main' ? 'node' : 'browser', '--format', target === 'main' ? 'cjs' : 'esm',
        '--external', 'electron', '--tsconfig-override', resolve('tsconfig.web.json'),
        '--outfile', join(temporary, target === 'main' ? 'main.cjs' : 'host.js')], { encoding: 'utf8' })
    }
    await writeFile(join(temporary, 'host.html'), '<!doctype html><body><script type="module" src="./host.js"></script>')
    const env = { ...process.env, BROWSER_CAPTURE_BUILD: temporary, BROWSER_CAPTURE_PROFILE: join(temporary, 'profile') }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: [join(temporary, 'main.cjs')], env })
    page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.captureHarness))
  })

  test.afterAll(async () => {
    await app?.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  })

  test('explains an offscreen crop, releases capture state, and succeeds after scrolling', async () => {
    const error = await page.evaluate(async () => {
      try { await window.captureHarness.capture('#target'); return null }
      catch (error) { return String(error) }
    })
    expect(error).toMatch(/outside the visible viewport.*browser_scroll/)
    expect(await page.evaluate(() => window.captureHarness.released())).toBe(true)
    expect(await page.evaluate(() => window.captureHarness.execute(
      'document.querySelectorAll("[data-superone-capture-scale-probe]").length',
    ))).toBe(0)

    await page.evaluate(() => window.captureHarness.execute('document.querySelector("#target").scrollIntoView()'))
    const image = await page.evaluate(() => window.captureHarness.capture('#target'))
    expect(image.width / image.height).toBeCloseTo(300 / 44)
    expect(image.data.length).toBeGreaterThan(100)
    expect(await page.evaluate(() => window.captureHarness.released())).toBe(true)
  })

  test('clips a partially visible element to the viewport and captures the right pixels', async () => {
    await page.evaluate(() => window.captureHarness.execute(`(() => {
      scrollTo(0, 0);
      document.getElementById('target').style.cssText = 'left:-20.25px;top:380.25px;width:300px;height:44px';
    })()`))
    const image = await page.evaluate(() => window.captureHarness.capture('#target'))
    expect(image.width / image.height).toBeCloseTo(280 / 20)
    const center = await page.evaluate(async image => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${image.data}`)).blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      return [...context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data]
    }, image)
    expect(center).toEqual([255, 0, 0, 255])
    expect(await page.evaluate(() => window.captureHarness.released())).toBe(true)
  })

  test('rejects missing, empty and fully out-of-bounds elements without changing the scroll position', async () => {
    for (const [selector, style, expected] of [
      ['#missing', '', /did not resolve to a visible element/],
      ['#target', 'display:none', /did not resolve to a visible element/],
      ['#target', 'left:640px;top:0', /outside the visible viewport/],
      ['#target', 'left:-300px;top:0', /outside the visible viewport/],
      ['#target', 'left:0;top:-44px', /outside the visible viewport/],
    ] as const) {
      await page.evaluate(style => window.captureHarness.execute(`(() => {
        scrollTo(0, 0);
        document.getElementById('target').style.cssText = ${JSON.stringify(style)};
      })()`), style)
      const error = await page.evaluate(async selector => {
        try { await window.captureHarness.capture(selector); return null }
        catch (error) { return String(error) }
      }, selector)
      expect(error).toMatch(expected)
      expect(await page.evaluate(() => window.captureHarness.released())).toBe(true)
      expect(await page.evaluate(() => window.captureHarness.execute('[scrollX, scrollY]'))).toEqual([0, 0])
    }
  })
})
