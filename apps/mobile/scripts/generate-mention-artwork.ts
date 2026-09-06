import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as lucide from 'lucide-react'
import { DefaultMiniAppIcon } from '../../../packages/ui/src/components/ui/DefaultMiniAppIcon'
import { desktopMentionGlyphs } from './mention-glyphs'
import files from '../src/ui/file-icons.generated.json'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../src/theme/tokens.generated'

// Native text attachments require images. Keep SVG as the source of truth and
// prepare enough pixels for enlarged text on high-density devices without any
// hidden-view rendering or image conversion during typing.
const pixels = 128
const colors = [...new Set([GENERATED_DARK_COLORS.foreground, ...Object.values(GENERATED_LIGHT_COLORS).map((theme) => theme.foreground)])].sort()
const variants: Record<string, Record<string, string>> = {}
const images: Record<string, string> = {}
for (const color of colors) {
  const entries: Record<string, string> = {}
  for (const [id, svg] of Object.entries(files.artwork)) {
    const source = svg.replace('<svg ', `<svg color="${color}" `)
    const png = await sharp(Buffer.from(source)).resize(pixels, pixels).png({ compressionLevel: 9 }).toBuffer()
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 16)
    entries[id] = hash
    images[hash] = png.toString('base64')
  }
  variants[color] = entries
}
const glyphs: Record<string, { icon: string; light: string; dark: string; artwork: Record<string, string> }> = {}
for (const [kind, glyph] of Object.entries(desktopMentionGlyphs())) {
  const Icon = (lucide as unknown as Record<string, ComponentType<{ color: string }>>)[glyph.icon]
  if (!Icon) throw new Error(`Unknown desktop Lucide icon: ${glyph.icon}`)
  const inks = [...new Set([glyph.light, glyph.dark].flatMap((tone) => tone === '$foreground' ? colors : [tone]))]
  const artwork: Record<string, string> = {}
  for (const color of inks) {
    const svg = renderToStaticMarkup(createElement(Icon, { color }))
    const png = await sharp(Buffer.from(svg)).resize(pixels, pixels).png({ compressionLevel: 9 }).toBuffer()
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 16)
    artwork[color] = hash
    images[hash] = png.toString('base64')
  }
  glyphs[kind] = { ...glyph, artwork }
}
// MiniAppIcon uses this desktop asset whenever an app has no manifest logo.
// Include the same artwork so mobile suggestions and native chips share that fallback.
const miniAppSvg = renderToStaticMarkup(createElement(DefaultMiniAppIcon))
const miniAppPng = await sharp(Buffer.from(miniAppSvg)).resize(pixels, pixels).png({ compressionLevel: 9 }).toBuffer()
const miniAppHash = createHash('sha256').update(miniAppPng).digest('hex').slice(0, 16)
images[miniAppHash] = miniAppPng.toString('base64')
glyphs.miniapp = { icon: 'default-app-icon', light: '$asset', dark: '$asset', artwork: { $asset: miniAppHash } }
const target = resolve(import.meta.dirname, '../src/ui/mention-artwork.generated.json')
const output = JSON.stringify({ pixels, variants, glyphs, images }) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Native mention artwork is stale; run generate:icons')
} else writeFileSync(target, output)
console.log(`Native mention artwork: ${Object.keys(images).length} images, ${colors.length} ink variants, ${pixels}px`)
