import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  Anthropic,
  OpenRouter,
  Zhipu,
  Kimi,
  Minimax,
  Volcengine,
  Bailian,
  Bedrock,
  Google,
  DeepSeek,
  Doubao,
  KwaiKAT,
  LongCat,
  ModelScope,
  Nvidia,
  SiliconCloud,
  XiaomiMiMo,
  OpenAI,
} from '@lobehub/icons'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../../super-one-flutter/assets/svg/providers')

type IconComp = Parameters<typeof createElement>[0]

function pickColor(ns: { Color?: unknown }): IconComp | undefined {
  return (ns.Color as IconComp | undefined) ?? undefined
}
function pickText(ns: { Text?: unknown }): IconComp | undefined {
  return (ns.Text as IconComp | undefined) ?? undefined
}

interface BrandEntry {
  key: string
  mono: IconComp
  color?: IconComp
  text?: IconComp
  brand?: IconComp
  textMultiple: number
  spaceMultiple: number
}

const ICONS: BrandEntry[] = [
  { key: 'anthropic', mono: Anthropic as IconComp, text: pickText(Anthropic), textMultiple: 0.75, spaceMultiple: 0.1 },
  { key: 'openrouter', mono: OpenRouter as IconComp, text: pickText(OpenRouter), textMultiple: 1.0, spaceMultiple: 0.4 },
  { key: 'zhipu', mono: Zhipu as IconComp, color: pickColor(Zhipu), text: pickText(Zhipu), textMultiple: 0.65, spaceMultiple: 0.2 },
  { key: 'kimi', mono: Kimi as IconComp, color: pickColor(Kimi), text: pickText(Kimi), textMultiple: 0.7, spaceMultiple: 0.25 },
  { key: 'minimax', mono: Minimax as IconComp, color: pickColor(Minimax), text: pickText(Minimax), textMultiple: 0.45, spaceMultiple: 0.15 },
  { key: 'volcengine', mono: Volcengine as IconComp, color: pickColor(Volcengine), text: pickText(Volcengine), textMultiple: 0.8, spaceMultiple: 0.2 },
  { key: 'bailian', mono: Bailian as IconComp, color: pickColor(Bailian), text: pickText(Bailian), textMultiple: 0.8, spaceMultiple: 0.2 },
  { key: 'bedrock', mono: Bedrock as IconComp, color: pickColor(Bedrock), text: pickText(Bedrock), textMultiple: 0.6, spaceMultiple: 0.1 },
  { key: 'google', mono: Google as IconComp, color: pickColor(Google), brand: (Google as { Brand?: unknown }).Brand as IconComp | undefined, textMultiple: 1.0, spaceMultiple: 0 },
  { key: 'deepseek', mono: DeepSeek as IconComp, color: pickColor(DeepSeek), text: pickText(DeepSeek), textMultiple: 0.65, spaceMultiple: 0.2 },
  { key: 'doubao', mono: Doubao as IconComp, color: pickColor(Doubao), text: pickText(Doubao), textMultiple: 0.8, spaceMultiple: 0.15 },
  { key: 'kwaikat', mono: KwaiKAT as IconComp, text: pickText(KwaiKAT), textMultiple: 0.9, spaceMultiple: 0.2 },
  { key: 'longcat', mono: LongCat as IconComp, color: pickColor(LongCat), text: pickText(LongCat), textMultiple: 0.8, spaceMultiple: 0.3 },
  { key: 'modelscope', mono: ModelScope as IconComp, color: pickColor(ModelScope), text: pickText(ModelScope), textMultiple: 0.6, spaceMultiple: 0.2 },
  { key: 'nvidia', mono: Nvidia as IconComp, color: pickColor(Nvidia), text: pickText(Nvidia), textMultiple: 0.5, spaceMultiple: 0.15 },
  { key: 'siliconcloud', mono: SiliconCloud as IconComp, color: pickColor(SiliconCloud), text: pickText(SiliconCloud), textMultiple: 0.7, spaceMultiple: 0.2 },
  { key: 'xiaomimimo', mono: XiaomiMiMo as IconComp, text: pickText(XiaomiMiMo), textMultiple: 1.0, spaceMultiple: 0.2 },
  { key: 'openai', mono: OpenAI as IconComp, text: pickText(OpenAI), textMultiple: 0.75, spaceMultiple: 0.1 },
]

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

function renderSvg(comp: IconComp): string {
  const html = renderToStaticMarkup(createElement(comp, { size: 24 }))
  return html.replace(/<title>[^<]*<\/title>/g, '')
}

function extractViewBox(svg: string): { w: number; h: number } {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  if (!m) return { w: 24, h: 24 }
  return { w: parseFloat(m[1]), h: parseFloat(m[2]) }
}

function innerSvg(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
}

function buildCombined(markSvg: string, textSvg: string, textMultiple: number, spaceMultiple: number): string {
  const mark = extractViewBox(markSvg)
  const text = extractViewBox(textSvg)
  const markH = 24
  const markW = markH * (mark.w / mark.h)
  const textH = markH * textMultiple
  const textW = textH * (text.w / text.h)
  const space = markH * spaceMultiple
  const totalW = markW + space + textW
  const totalH = markH
  const markScale = markH / mark.h
  const textScale = textH / text.h
  const textY = (totalH - textH) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(3)} ${totalH}" fill="currentColor">` +
    `<g transform="scale(${markScale.toFixed(6)})">${innerSvg(markSvg)}</g>` +
    `<g transform="translate(${(markW + space).toFixed(3)} ${textY.toFixed(3)}) scale(${textScale.toFixed(6)})" fill="currentColor">${innerSvg(textSvg)}</g>` +
    `</svg>`
}

const manifest: Record<string, { mono: boolean; color: boolean; combined: boolean; combinedAspect?: number }> = {}

for (const entry of ICONS) {
  const monoSvg = renderSvg(entry.mono)
  writeFileSync(join(OUT_DIR, `${entry.key}.svg`), monoSvg)
  if (entry.color) writeFileSync(join(OUT_DIR, `${entry.key}-color.svg`), renderSvg(entry.color))

  let combined: string | null = null
  let aspect: number | undefined
  if (entry.brand) {
    combined = renderSvg(entry.brand)
    const vb = extractViewBox(combined)
    aspect = vb.w / vb.h
  } else if (entry.text) {
    const markSvg = entry.color ? renderSvg(entry.color) : monoSvg
    combined = buildCombined(markSvg, renderSvg(entry.text), entry.textMultiple, entry.spaceMultiple)
    const vb = extractViewBox(combined)
    aspect = vb.w / vb.h
  }
  if (combined) writeFileSync(join(OUT_DIR, `${entry.key}-combined.svg`), combined)
  manifest[entry.key] = { mono: true, color: !!entry.color, combined: !!combined, combinedAspect: aspect }
  console.log(`wrote ${entry.key}: mono${entry.color ? '+color' : ''}${combined ? `+combined(${aspect?.toFixed(2)})` : ''}`)
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nDone. Output: ${OUT_DIR}`)
