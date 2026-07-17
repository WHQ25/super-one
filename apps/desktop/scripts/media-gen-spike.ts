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

async function runArk(apiKey: string): Promise<void> {
  const provider: MediaProviderConfig = {
    id: 'volcengine',
    kind: 'ark',
    apiKey,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  }
  const model = 'doubao-seedream-5-0-260128'

  await step('ark · text-to-image (Seedream 5.0 Lite, no size → 2K default)', async () => {
    const res = await generateMedia(
      { provider, model, prompt: 'a single red LEGO brick on a white background, product photo' },
      { outputDir: OUT_DIR, generationId: `ark-t2i-${randomUUID()}` },
    )
    console.log('  ✔ saved:', res.images.map((i) => i.path))
    console.log('  warnings:', res.warnings)
  })

  // The regression this adapter exists for: the generic openai-compatible model posts multipart to
  // /images/edits, which Ark does not have, so every reference-image call 404'd.
  await step('ark · image-to-image with a reference image (used to be a hard 404)', async () => {
    const iconPath = join(import.meta.dirname, '..', '..', '..', 'docs', 'logo', 'app-icon.png')
    const res = await generateMedia(
      {
        provider,
        model,
        prompt:
          'Change the background baseplate color from black to white. Keep the colorful LEGO bricks spelling "SUPER ONE" exactly as they are.',
        referenceImages: [{ mediaType: 'image/png', data: readFileSync(iconPath) }],
      },
      { outputDir: OUT_DIR, generationId: `ark-i2i-${randomUUID()}` },
    )
    console.log('  ✔ saved:', res.images.map((i) => i.path))
    console.log('  warnings:', res.warnings)
  })

  await step('ark · size below the ~3.7MP floor → expect a clear Ark error, not a 404', async () => {
    const res = await generateMedia(
      { provider, model, prompt: 'a blue cube', size: '1024x1024' },
      { outputDir: OUT_DIR, generationId: `ark-small-${randomUUID()}` },
    )
    console.log('  ✔ saved (unexpected — the floor may have moved):', res.images.map((i) => i.path))
  })
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
  const arkKey = process.env.ARK_API_KEY
  if (!openaiKey && !geminiKey && !arkKey) {
    console.error('Set OPENAI_API_KEY and/or GEMINI_API_KEY and/or ARK_API_KEY to run the spike.')
    process.exit(1)
  }
  if (openaiKey) await runOpenAI(openaiKey)
  if (geminiKey) await runGoogle(geminiKey)
  if (arkKey) await runArk(arkKey)
  console.log('\nDone.')
}

void main()
