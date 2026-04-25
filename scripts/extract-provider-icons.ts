import { writeFileSync, mkdirSync } from 'fs'
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

const ICONS: Array<{ key: string; Mono: IconComp }> = [
  { key: 'anthropic', Mono: Anthropic as IconComp },
  { key: 'openrouter', Mono: OpenRouter as IconComp },
  { key: 'zhipu', Mono: Zhipu as IconComp },
  { key: 'kimi', Mono: Kimi as IconComp },
  { key: 'minimax', Mono: Minimax as IconComp },
  { key: 'volcengine', Mono: Volcengine as IconComp },
  { key: 'bailian', Mono: Bailian as IconComp },
  { key: 'bedrock', Mono: Bedrock as IconComp },
  { key: 'google', Mono: Google as IconComp },
  { key: 'deepseek', Mono: DeepSeek as IconComp },
  { key: 'doubao', Mono: Doubao as IconComp },
  { key: 'kwaikat', Mono: KwaiKAT as IconComp },
  { key: 'longcat', Mono: LongCat as IconComp },
  { key: 'modelscope', Mono: ModelScope as IconComp },
  { key: 'nvidia', Mono: Nvidia as IconComp },
  { key: 'siliconcloud', Mono: SiliconCloud as IconComp },
  { key: 'xiaomimimo', Mono: XiaomiMiMo as IconComp },
  { key: 'openai', Mono: OpenAI as IconComp },
]

mkdirSync(OUT_DIR, { recursive: true })

for (const { key, Mono } of ICONS) {
  const html = renderToStaticMarkup(createElement(Mono, { size: 24 }))
  const svg = html.replace(/<title>[^<]*<\/title>/g, '')
  writeFileSync(join(OUT_DIR, `${key}.svg`), svg)
  console.log(`wrote ${key}.svg (${svg.length} bytes)`)
}

console.log(`\nDone. Output: ${OUT_DIR}`)
