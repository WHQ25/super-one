import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from '@playwright/test'
import { PROVIDER_BRAND_KEYS, providerBrandMarks } from '../../desktop/src/renderer/src/components/ProviderLabel'
import {
  TIGHT_COMBINE_SPACE_MULTIPLE,
  TIGHT_COMBINE_TEXT_MULTIPLE,
} from '../../desktop/src/renderer/src/components/TightCombine'

/**
 * The desktop draws API-provider brands as a `TightCombine` lockup: the icon
 * and the word mark, each cropped to its ink box so the pair reads as one
 * unit. That crop needs `getBBox`, which only a real engine can answer, so we
 * measure once here and ship the cropped SVG plus its aspect. React Native
 * then reproduces the same layout with `react-native-svg` — vector, and mono
 * marks still follow the theme through `currentColor`.
 */
type Mark = { svg: string; aspect: number }
type Brand = { icon: Mark; text?: Mark; extra?: string }

/** Strip the intrinsic box and the DOM-only style hint; the caller sizes it. */
function bare(markup: string): string {
  return markup.replace(/\s(?:width|height)="[^"]*"/g, '').replace(/\sstyle="[^"]*"/g, '')
}

const pending: Array<{ key: string; icon: string; text?: string; extra?: string }> = []
for (const key of PROVIDER_BRAND_KEYS) {
  const marks = providerBrandMarks(key)
  if (!marks) throw new Error(`Brand "${key}" resolved to no marks`)
  pending.push({
    key,
    icon: bare(renderToStaticMarkup(createElement(marks.Icon, { size: 24 }))),
    ...(marks.Text ? { text: bare(renderToStaticMarkup(createElement(marks.Text, { size: 18 }))) } : {}),
    ...(marks.extraLabel ? { extra: marks.extraLabel } : {}),
  })
}

const browser = await chromium.launch()
const brands: Record<string, Brand> = {}
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) => route.abort())
  for (const entry of pending) {
    const svgs = [entry.icon, ...(entry.text ? [entry.text] : [])]
    await page.setContent(`<body style="margin:0">${svgs.map((svg, i) => `<span data-i="${i}">${svg}</span>`).join('')}</body>`)
    const boxes = await page.$$eval('svg', (nodes) => nodes.map((node) => {
      const box = (node as SVGSVGElement).getBBox()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }))
    const crop = (svg: string, index: number): Mark => {
      const box = boxes[index]
      if (!box?.width || !box.height) throw new Error(`Brand "${entry.key}" mark ${index} has an empty ink box`)
      return {
        svg: svg.replace(/viewBox="[^"]*"/, `viewBox="${box.x} ${box.y} ${box.width} ${box.height}"`),
        aspect: Math.round((box.width / box.height) * 1000) / 1000,
      }
    }
    brands[entry.key] = {
      icon: crop(entry.icon, 0),
      ...(entry.text ? { text: crop(entry.text, 1) } : {}),
      ...(entry.extra ? { extra: entry.extra } : {}),
    }
  }
} finally {
  await browser.close()
}

const target = resolve(import.meta.dirname, '../src/ui/provider-brands.generated.json')
const output = JSON.stringify({
  textMultiple: TIGHT_COMBINE_TEXT_MULTIPLE,
  spaceMultiple: TIGHT_COMBINE_SPACE_MULTIPLE,
  brands,
}, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Native provider brands are stale; run generate:icons')
} else writeFileSync(target, output)
const withText = Object.values(brands).filter((brand) => brand.text).length
console.log(`Native provider brands: ${Object.keys(brands).length} marks, ${withText} with word marks`)
