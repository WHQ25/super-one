/**
 * The composer-image path, end to end through the real tree.
 *
 * The interesting property is not "an image can be sent" — it is that an image
 * is only ever stored when the routed model can actually be sent it. dsh keeps
 * images in durable history and `llm-deepseek` refuses image content while
 * SERIALIZING a request from that history, so an image admitted for a text-only
 * model breaks every later turn of the session rather than just its own.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AgentEvent, ImageAttachment } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { encodeComposerImages, modelAcceptsImages } from './images'
import { TEST_PRESET_OPTIONS } from './test-presets'

/** A 1x1 PNG, the smallest thing the store will actually decode and accept. */
const PNG_1X1_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function attachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return { mimeType: 'image/png', base64: PNG_1X1_BASE64, name: 'pixel.png', ...overrides }
}

/**
 * Two routes on one adapter: one that declares the `image` modality and one
 * that declares nothing, which upstream reads as text-only. Both are needed in
 * the same tree so the only difference between the two assertions is the model.
 */
class ModalityAdapter extends LlmAdapter {
  /** Every message list this adapter was asked to serialize. */
  readonly seen: GenerateOptions['messages'][] = []

  override async listModels(): Promise<readonly LlmModelInfo[]> {
    return [
      { provider: 'mock', id: 'vision-1', name: 'Vision', inputModalities: ['text', 'image'] },
      { provider: 'mock', id: 'text-1', name: 'Text' },
    ]
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return model === 'vision-1'
      ? { provider, id: model, name: 'Vision', inputModalities: ['text', 'image'] }
      : { provider, id: model, name: 'Text' }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options.messages)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const dirs: string[] = []
const runtimes: DeepseekRuntime[] = []

/**
 * @param withStore - whether to mount the durable attachment store at all.
 */
async function boot(withStore: boolean) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-images-'))
  dirs.push(home)
  const runtime = await DeepseekRuntime.create({
    ...TEST_PRESET_OPTIONS,
    persona: 'test agent',
    ...(withStore ? { attachmentHome: home } : {}),
  })
  runtimes.push(runtime)
  const adapter = new ModalityAdapter()
  runtime.context.llm.registerAdapter(['mock'], adapter)
  return { runtime, adapter }
}

async function agentOn(runtime: DeepseekRuntime, model: string) {
  const events: AgentEvent[] = []
  return runtime.createAgent({
    sessionId: randomUUID(),
    cwd: process.cwd(),
    provider: 'mock',
    model,
    onEvent: (event) => events.push(event),
  })
}

afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('composer image projection', () => {
  it('projects every admissible attachment, order preserved', () => {
    expect(encodeComposerImages([
      attachment(),
      attachment({ mimeType: 'image/webp', name: 'shot.webp' }),
    ])).toEqual([
      { mediaType: 'image/png', data: PNG_1X1_BASE64, name: 'pixel.png' },
      { mediaType: 'image/webp', data: PNG_1X1_BASE64, name: 'shot.webp' },
    ])
  })

  /**
   * Reachable input, not a hypothetical: the composer accepts `image/*` and
   * keeps the file's own media type verbatim whenever the image is small enough
   * to skip canvas re-encoding, so heic / avif / svg arrive here untouched.
   * Skipping them would send the turn as plain text — the user would see their
   * attachment chip in the transcript and never learn the model did not get it.
   */
  it('refuses a payload dsh cannot admit rather than sending the turn without it', () => {
    expect(() => encodeComposerImages([
      attachment(),
      attachment({ mimeType: 'image/svg+xml', name: 'logo.svg' }),
    ])).toThrow(/logo\.svg.*image\/svg\+xml/)
  })

  it('refuses an attachment chip whose bytes never arrived', () => {
    expect(() => encodeComposerImages([attachment({ base64: '', name: 'empty.png' })]))
      .toThrow(/empty\.png/)
  })

  it('treats an undisclosed modality list as text-only, the way upstream does', () => {
    expect(modelAcceptsImages(undefined)).toBe(false)
    expect(modelAcceptsImages(['text'])).toBe(false)
    expect(modelAcceptsImages(['text', 'image'])).toBe(true)
  })
})

describe('attachment service resolution', () => {
  /**
   * The realm risk, asserted rather than assumed. dsh presets put services
   * behind entry-local `isolate` realms, and a service mounted outside such a
   * realm is invisible to rows inside it. The store is mounted flat on the root
   * context precisely so that both `llm-deepseek` (which resolves it with
   * `ctx.get('attachments')` from its own plugin context) and a preset-composed
   * `read_image` see the same instance. This boots with the shipped preset
   * roster, which is the composition that would expose a realm mistake.
   */
  it('resolves one store from the tree root with the shipped presets mounted', async () => {
    const { runtime } = await boot(true)
    const store = runtime.context.get('attachments')
    expect(store).toBeDefined()
    expect(store?.imageLimits.mediaTypes).toContain('image/png')
  }, 30000)
})

describe('sending images through the tree', () => {
  it('stores the image and puts a reference — not bytes — in the request', async () => {
    const { runtime, adapter } = await boot(true)
    const agent = await agentOn(runtime, 'vision-1')

    await agent.sendText('what is this', [attachment()])
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()

    const serialized = JSON.stringify(adapter.seen)
    expect(serialized).toContain('"type":"image"')
    // The whole point of the content-addressed store: the durable message
    // carries a reference, and the raw base64 never enters the message graph.
    expect(serialized).toContain('attachmentId')
    expect(serialized).not.toContain(PNG_1X1_BASE64)

    await agent.dispose()
  }, 30000)

  it('refuses a text-only model before anything is stored or queued', async () => {
    const { runtime, adapter } = await boot(true)
    const agent = await agentOn(runtime, 'text-1')

    await expect(agent.sendText('what is this', [attachment()]))
      .rejects.toThrow(/does not accept image input/)

    // Nothing was queued: the refusal happened before `followup`, so the model
    // was never called and the session log holds no poisoned message. This is
    // the assertion that matters — the adapter's own refusal would arrive too
    // late, with the image already durable and every later turn failing on it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(adapter.seen).toHaveLength(0)

    // The session is still usable for text, which is what "nothing durable was
    // written" actually means to a user.
    await agent.sendText('plain text')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()
    expect(adapter.seen).toHaveLength(1)

    await agent.dispose()
  }, 30000)

  /**
   * The mechanism the modality gate exists to prevent, demonstrated rather than
   * asserted from upstream source: an admitted image is part of durable history
   * and is re-serialized into EVERY later request. So a model-side refusal of
   * image content is not a one-turn failure — it repeats for the life of the
   * session, and no amount of retrying or sending plain text clears it.
   */
  it('re-sends an admitted image on every later turn, which is why the gate is not optional', async () => {
    const { runtime, adapter } = await boot(true)
    const agent = await agentOn(runtime, 'vision-1')

    await agent.sendText('first, with an image', [attachment()])
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()

    await agent.sendText('second, plain text')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()

    expect(adapter.seen).toHaveLength(2)
    // The image is still in the SECOND request, which carried no attachment.
    expect(JSON.stringify(adapter.seen[1])).toContain('"type":"image"')

    await agent.dispose()
  }, 30000)

  it('refuses when no attachment store is mounted', async () => {
    const { runtime } = await boot(false)
    const agent = await agentOn(runtime, 'vision-1')

    await expect(agent.sendText('what is this', [attachment()]))
      .rejects.toThrow(/no attachment store/)

    await agent.dispose()
  }, 30000)

  it('leaves a text-only send unchanged when no images are attached', async () => {
    const { runtime, adapter } = await boot(true)
    const agent = await agentOn(runtime, 'text-1')

    await agent.sendText('hello')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()

    expect(JSON.stringify(adapter.seen)).not.toContain('"type":"image"')
    await agent.dispose()
  }, 30000)
})
