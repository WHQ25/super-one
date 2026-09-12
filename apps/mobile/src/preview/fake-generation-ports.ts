import type { MediaProviderLabel } from '@superone/shared/agent-types'
import type { ImageGenerationPorts } from '../image-generation-ports'

/** The catalogue a fake host answers with; matches the ids `TOOL_GENERATION` reports. */
export const FAKE_MEDIA_PROVIDERS: MediaProviderLabel[] = [
  { id: 'openai', label: 'OpenAI Images', providerLabel: 'OpenAI', models: [{ id: 'gpt-image-1', label: 'GPT Image 1' }] },
  { id: 'volcengine', label: 'Volcengine', models: [{ id: 'seedream-4', label: 'Seedream 4.0' }] },
]

/** A picture with something to look at; the 2×2 fixture PNG reads as an empty square at thumb size. */
const REFERENCE_IMAGE_URI = 'https://picsum.photos/seed/superone-reference/200/200'

/**
 * Generation ports that never touch a host. `images` picks what a reference
 * thumb resolves to: a picture, the file-name fallback (a relay transfer the
 * user has not approved), or a failure; `providers` empty leaves the raw ids.
 */
export function createFakeGenerationPorts(options: {
  images?: 'bytes' | 'name' | 'throw'
  providers?: MediaProviderLabel[]
  delayMs?: number
} = {}): ImageGenerationPorts {
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 0))
  return {
    async loadImage() {
      await wait()
      if (options.images === 'throw') throw new Error('read failed')
      return options.images === 'name' ? null : REFERENCE_IMAGE_URI
    },
    async listMediaProviders() {
      await wait()
      return options.providers ?? FAKE_MEDIA_PROVIDERS
    },
  }
}
