import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`)
      return p
    } catch {}
  }
  return null
}

const exec = findChrome()
if (!exec) {
  console.error('No Chrome/Chromium/Edge binary found at standard macOS locations.')
  process.exit(1)
}

const STORYBOOK = 'http://localhost:6006'

const SHOTS = [
  { id: 'web-mocks-desktop-newsessionmock--default', file: 'new-session-claude.png', themes: ['light', 'dark'] },
  { id: 'web-mocks-desktop-newsessionmock--controlled-codex', file: 'new-session-codex.png', themes: ['light', 'dark'] },
  { id: 'web-mocks-desktop-chatmock--default', file: 'chat-default.png', themes: ['light', 'dark'] },
  { id: 'web-mocks-desktop-chatmock--short-conversation', file: 'chat-short.png', themes: ['light', 'dark'] },
]

const browser = await chromium.launch({ executablePath: exec, headless: true })
const scale = Number(process.env.SCALE ?? 2)
const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: scale })
const page = await ctx.newPage()

for (const shot of SHOTS) {
  for (const theme of shot.themes) {
    const url = `${STORYBOOK}/iframe.html?id=${shot.id}&viewMode=story&globals=backgrounds.value:!hex(F5F0E6)`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('dark', t === 'dark')
      document.body.style.background = t === 'dark' ? '#1a1a1a' : '#f5f0e6'
      const id = '__sb_capture_overrides__'
      let style = document.getElementById(id)
      if (!style) {
        style = document.createElement('style')
        style.id = id
        style.textContent = `
          [data-storybook-overlay] { display: none !important; }
        `
        document.head.appendChild(style)
      }
    }, theme)
    await page.waitForTimeout(400)
    const out = resolve(here, shot.file.replace('.png', `-${theme}.png`))
    await page.screenshot({ path: out, fullPage: false })
    console.log('wrote', out)
  }
}

await browser.close()
