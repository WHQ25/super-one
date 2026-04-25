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
}

const ICONS: BrandEntry[] = [
  { key: 'anthropic', mono: Anthropic as IconComp, text: pickText(Anthropic) },
  { key: 'openrouter', mono: OpenRouter as IconComp, text: pickText(OpenRouter) },
  { key: 'zhipu', mono: Zhipu as IconComp, color: pickColor(Zhipu), text: pickText(Zhipu) },
  { key: 'kimi', mono: Kimi as IconComp, color: pickColor(Kimi), text: pickText(Kimi) },
  { key: 'minimax', mono: Minimax as IconComp, color: pickColor(Minimax), text: pickText(Minimax) },
  { key: 'volcengine', mono: Volcengine as IconComp, color: pickColor(Volcengine), text: pickText(Volcengine) },
  { key: 'bailian', mono: Bailian as IconComp, color: pickColor(Bailian), text: pickText(Bailian) },
  { key: 'bedrock', mono: Bedrock as IconComp, color: pickColor(Bedrock), text: pickText(Bedrock) },
  { key: 'google', mono: Google as IconComp, color: pickColor(Google), brand: (Google as { Brand?: unknown }).Brand as IconComp | undefined },
  { key: 'deepseek', mono: DeepSeek as IconComp, color: pickColor(DeepSeek), text: pickText(DeepSeek) },
  { key: 'doubao', mono: Doubao as IconComp, color: pickColor(Doubao), text: pickText(Doubao) },
  { key: 'kwaikat', mono: KwaiKAT as IconComp, text: pickText(KwaiKAT) },
  { key: 'longcat', mono: LongCat as IconComp, color: pickColor(LongCat), text: pickText(LongCat) },
  { key: 'modelscope', mono: ModelScope as IconComp, color: pickColor(ModelScope), text: pickText(ModelScope) },
  { key: 'nvidia', mono: Nvidia as IconComp, color: pickColor(Nvidia), text: pickText(Nvidia) },
  { key: 'siliconcloud', mono: SiliconCloud as IconComp, color: pickColor(SiliconCloud), text: pickText(SiliconCloud) },
  { key: 'xiaomimimo', mono: XiaomiMiMo as IconComp, text: pickText(XiaomiMiMo) },
  { key: 'openai', mono: OpenAI as IconComp, text: pickText(OpenAI) },
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

const DESKTOP_TEXT_MULTIPLE = 0.75
const DESKTOP_SPACE_MULTIPLE = 0.5

function buildCombined(markSvg: string, textSvg: string): string {
  const mark = extractViewBox(markSvg)
  const text = extractViewBox(textSvg)
  const markH = 24
  const markW = markH * (mark.w / mark.h)
  const textH = markH * DESKTOP_TEXT_MULTIPLE
  const textW = textH * (text.w / text.h)
  const space = markH * DESKTOP_SPACE_MULTIPLE
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
    combined = buildCombined(markSvg, renderSvg(entry.text))
    const vb = extractViewBox(combined)
    aspect = vb.w / vb.h
  }
  if (combined) writeFileSync(join(OUT_DIR, `${entry.key}-combined.svg`), combined)
  manifest[entry.key] = { mono: true, color: !!entry.color, combined: !!combined, combinedAspect: aspect }
  console.log(`wrote ${entry.key}: mono${entry.color ? '+color' : ''}${combined ? `+combined(${aspect?.toFixed(2)})` : ''}`)
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nDone. Output: ${OUT_DIR}`)
