import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from '@playwright/test'
import { AgentProfileIcon } from '../../../packages/ui/src/components/harness/AgentProfileIcon'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../src/theme/tokens.generated'

// Use the complete desktop DOM + compiled CSS: some marks have non-SVG layers.
// The caller builds chat-view first so its stylesheet reflects current sources.
const root = resolve(import.meta.dirname, '../../..')
const document = readFileSync(resolve(root, 'packages/chat-view/dist/index.html'), 'utf8')
const css = [...document.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
if (!css.includes('mention-chip__icon')) throw new Error('Build chat-view before generating brand artwork')
const refs = {
  claude: 'claude-base', codex: 'codex-base', 'acp-grok': 'acp-base:grok-build',
  'acp-opencode': 'acp-base:opencode', opencode: 'opencode-base', cursor: 'cursor-base',
  dsh: 'dsh-base', acp: 'acp-base:custom', '$unknown': 'unknown-base',
}
const themes = {
  light: [...new Set(Object.values(GENERATED_LIGHT_COLORS).map((theme) => theme.foreground))].sort(),
  dark: [GENERATED_DARK_COLORS.foreground],
}
const variants: Record<string, Record<string, Record<string, string>>> = {}
const images: Record<string, string> = {}
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 32, height: 32 }, deviceScaleFactor: 8, reducedMotion: 'reduce' })
  await page.route('**/*', (route) => route.abort())
  for (const [scheme, colors] of Object.entries(themes)) {
    variants[scheme] = {}
    for (const foreground of colors) {
      const artwork: Record<string, string> = {}
      for (const [brand, refValue] of Object.entries(refs)) {
        const icon = renderToStaticMarkup(createElement(AgentProfileIcon, { refValue }))
        await page.setContent(`<html class="${scheme === 'dark' ? 'dark' : ''}"><head><style>${css}</style>
          <style>:root{--foreground:${foreground}}html:root,body{margin:0;background:transparent!important;color-scheme:light}
          #mark{font-size:16px;color:var(--foreground);margin:0;vertical-align:top}
          #mark *{animation:none!important;transition:none!important}</style></head>
          <body><span id="mark" class="mention-chip__icon">${icon}</span></body></html>`)
        const png = await page.locator('#mark').screenshot({ omitBackground: true })
        const hash = createHash('sha256').update(png).digest('hex').slice(0, 16)
        artwork[brand] = hash
        images[hash] = png.toString('base64')
      }
      variants[scheme]![foreground] = artwork
    }
  }
} finally {
  await browser.close()
}
const target = resolve(root, 'apps/mobile/src/ui/mention-brands.generated.json')
const output = JSON.stringify({ pixels: 128, variants, images }) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Native mention brands are stale; run generate:icons')
} else writeFileSync(target, output)
console.log(`Native mention brands: ${Object.keys(images).length} images, ${Object.keys(refs).length} identities`)
