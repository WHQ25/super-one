import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateMedia } from '../src/main/media-gen/service'
import type { MediaProviderConfig } from '../src/main/media-gen/types'

const OUT_DIR = join(tmpdir(), 'media-gen-spike')

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`\n▶ ${label}\n`)
  try {
    await fn()
  } catch (error) {
    console.error(`  ✖ failed:`, error instanceof Error ? error.message : error)
  }
}

async function runOpenAI(apiKey: string): Promise<void> {
  const provider: MediaProviderConfig = { id: 'openai', kind: 'openai', apiKey }
  let firstPath = ''
  let firstMediaType = 'image/png'

  await step('openai · text-to-image (gpt-image-2, 1024x1024)', async () => {
    const res = await generateMedia(
      { provider, model: 'gpt-image-2', prompt: 'a single red apple on a plain white table, studio lighting', size: '1024x1024' },
      { outputDir: OUT_DIR, generationId: `openai-t2i-${randomUUID()}` },
    )
    firstPath = res.images[0].path
    firstMediaType = res.images[0].mediaType
    console.log('  ✔ saved:', res.images.map((i) => i.path))
    console.log('  warnings:', res.warnings)
  })

  if (firstPath) {
    await step('openai · image-to-image (edit previous output)', async () => {
      const res = await generateMedia(
        {
          provider,
          model: 'gpt-image-2',
          prompt: 'change the apple to green, keep everything else the same',
          referenceImages: [{ mediaType: firstMediaType, data: readFileSync(firstPath) }],
        },
        { outputDir: OUT_DIR, generationId: `openai-i2i-${randomUUID()}` },
      )
      console.log('  ✔ saved:', res.images.map((i) => i.path))
      console.log('  warnings:', res.warnings)
    })
  }
}

async function runGoogle(apiKey: string): Promise<void> {
  const provider: MediaProviderConfig = { id: 'google', kind: 'google', apiKey }
  let firstPath = ''
  let firstMediaType = 'image/png'

  await step('google · text-to-image (Nano Banana Pro, aspectRatio 16:9)', async () => {
    const res = await generateMedia(
      { provider, model: 'gemini-3-pro-image-preview', prompt: 'a cozy reading nook by a rainy window, warm light', aspectRatio: '16:9' },
      { outputDir: OUT_DIR, generationId: `google-t2i-${randomUUID()}` },
    )
    firstPath = res.images[0].path
    firstMediaType = res.images[0].mediaType
    console.log('  ✔ saved:', res.images.map((i) => i.path))
    console.log('  warnings:', res.warnings)
  })

  if (firstPath) {
    await step('google · mask on a model that does not support it → expect warnings, not an error', async () => {
      const res = await generateMedia(
        {
          provider,
          model: 'gemini-2.5-flash-image',
          prompt: 'add a small wizard hat',
          referenceImages: [{ mediaType: firstMediaType, data: readFileSync(firstPath) }],
          mask: readFileSync(firstPath),
        },
        { outputDir: OUT_DIR, generationId: `google-mask-${randomUUID()}` },
      )
      console.log('  ✔ saved:', res.images.map((i) => i.path))
      console.log('  warnings:', res.warnings)
    })
  }
}

async function main(): Promise<void> {
  console.log(`media-gen spike → output dir: ${OUT_DIR}`)
  const openaiKey = process.env.OPENAI_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!openaiKey && !geminiKey) {
    console.error('Set OPENAI_API_KEY and/or GEMINI_API_KEY to run the spike.')
    process.exit(1)
  }
  if (openaiKey) await runOpenAI(openaiKey)
  if (geminiKey) await runGoogle(geminiKey)
  console.log('\nDone.')
}

void main()
