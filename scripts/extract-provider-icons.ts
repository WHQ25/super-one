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

interface BrandEntry {
  key: string
  mono: IconComp
  color?: IconComp
  text?: IconComp
}

function pickColor(ns: { Color?: unknown }): IconComp | undefined {
  return (ns.Color as IconComp | undefined) ?? undefined
}
function pickText(ns: { Text?: unknown }): IconComp | undefined {
  return (ns.Text as IconComp | undefined) ?? undefined
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
  { key: 'google', mono: Google as IconComp, color: pickColor(Google), text: (Google as { Brand?: unknown }).Brand as IconComp | undefined },
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

const manifest: Record<string, { mono: boolean; color: boolean; text: boolean }> = {}

for (const { key, mono, color, text } of ICONS) {
  writeFileSync(join(OUT_DIR, `${key}.svg`), renderSvg(mono))
  if (color) writeFileSync(join(OUT_DIR, `${key}-color.svg`), renderSvg(color))
  if (text) writeFileSync(join(OUT_DIR, `${key}-text.svg`), renderSvg(text))
  manifest[key] = { mono: true, color: !!color, text: !!text }
  console.log(`wrote ${key}: mono${color ? '+color' : ''}${text ? '+text' : ''}`)
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nDone. Output: ${OUT_DIR}`)
