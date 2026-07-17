import { describe, it, expect } from 'vitest'
import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { toImageGenerationItems, isMediaGenerateImageTool, collectCodexGeneratedImages } from './media-generation'
import { isHiddenToolBlock } from './tool-display'

const TOOL = 'mcp__superone__media_generate_image'

const INPUT = {
  provider: 'bdd752ab',
  model: 'doubao-seedream-5-0-260128',
  prompt: 'a white baseplate',
  size: '2K',
  reference_image_paths: ['/tmp/app-icon.png'],
}

const RESULT = JSON.stringify({
  status: 'generated',
  generationId: '36bd5ca1',
  provider: 'Volcengine Ark',
  model: 'doubao-seedream-5-0-260128',
  savedPaths: ['/tmp/out/36bd5ca1-0.jpg'],
})

const ERROR_RESULT = JSON.stringify({ status: 'error', message: 'Ark returned 404 for /images/edits' })

describe('media_generate_image tool identification', () => {
  it('matches the superone media tool under any harness tool-name prefix', () => {
    expect(isMediaGenerateImageTool(TOOL)).toBe(true)
  })

  it('rejects a same-named tool from a different mcp server', () => {
    expect(isMediaGenerateImageTool('mcp__other__media_generate_image')).toBe(false)
  })
})

describe('suppressing the raw generate-image tool block', () => {
  it('hides the tool block on success because the gallery renders the image', () => {
    expect(isHiddenToolBlock(TOOL, RESULT)).toBe(true)
  })

  it('hides the tool block while the call is still running', () => {
    expect(isHiddenToolBlock(TOOL, undefined)).toBe(true)
  })

  it('shows the tool block on failure so the reason is visible', () => {
    expect(isHiddenToolBlock(TOOL, ERROR_RESULT)).toBe(false)
  })

  it('shows the tool block when the result is not a parseable generation summary', () => {
    expect(isHiddenToolBlock(TOOL, 'Error: connection reset')).toBe(false)
  })

  it('keeps hiding other suppressed tools regardless of result', () => {
    expect(isHiddenToolBlock('mcp__superone__session_rename', ERROR_RESULT)).toBe(true)
    expect(isHiddenToolBlock('TodoWrite', ERROR_RESULT)).toBe(true)
  })

  it.each([
    ['a successful generation', RESULT],
    ['a still-running call', undefined],
    ['a failed generation', ERROR_RESULT],
    ['a non-json error string', 'Error: connection reset'],
    ['an empty json object', '{}'],
  ])('hides the tool block exactly when the gallery has something to show for %s', (_label, result) => {
    const galleryShowsSomething = toImageGenerationItems('call-1', INPUT, result).length > 0
    expect(isHiddenToolBlock(TOOL, result)).toBe(galleryShowsSomething)
  })
})

describe('reference images used for a generation', () => {
  it('carries the reference image paths onto the item', () => {
    const items = toImageGenerationItems('call-1', INPUT, RESULT)
    expect(items[0].referenceImagePaths).toEqual(['/tmp/app-icon.png'])
  })

  it('omits reference paths when the call used none', () => {
    const items = toImageGenerationItems('call-1', { ...INPUT, reference_image_paths: [] }, RESULT)
    expect(items[0].referenceImagePaths).toBeUndefined()
  })

  it('no longer reports a bare reference-image count as a param', () => {
    const items = toImageGenerationItems('call-1', INPUT, RESULT)
    expect(items[0].params?.map((p) => p.key)).not.toContain('referenceImages')
  })

  it('carries reference paths onto an in-progress item too', () => {
    const items = toImageGenerationItems('call-1', INPUT, undefined)
    expect(items[0].referenceImagePaths).toEqual(['/tmp/app-icon.png'])
  })
})

describe('mapping a media_generate_image call to gallery items', () => {
  it('emits one completed item per saved path with provider metadata', () => {
    const items = toImageGenerationItems('call-1', INPUT, RESULT)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'call-1-0',
      type: 'image_generation',
      status: 'completed',
      savedPath: '/tmp/out/36bd5ca1-0.jpg',
      revisedPrompt: 'a white baseplate',
    })
    expect(items[0].params).toEqual(
      expect.arrayContaining([
        { key: 'provider', value: 'Volcengine Ark' },
        { key: 'model', value: 'doubao-seedream-5-0-260128' },
        { key: 'size', value: '2K' },
      ]),
    )
  })

  it('splits a multi-image result into one item per path', () => {
    const result = JSON.stringify({ status: 'generated', savedPaths: ['/tmp/a.jpg', '/tmp/b.jpg'] })
    const items = toImageGenerationItems('call-1', INPUT, result)
    expect(items.map((i) => i.savedPath)).toEqual(['/tmp/a.jpg', '/tmp/b.jpg'])
    expect(items.map((i) => i.id)).toEqual(['call-1-0', 'call-1-1'])
  })

  it('shows an in-progress placeholder while the result has not arrived', () => {
    const items = toImageGenerationItems('call-1', INPUT, undefined)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'call-1', status: 'in_progress', revisedPrompt: 'a white baseplate' })
    expect(items[0].savedPath).toBeUndefined()
  })

  it('carries warnings through onto the generated item', () => {
    const result = JSON.stringify({ status: 'generated', savedPaths: ['/tmp/a.jpg'], warnings: ['size clamped'] })
    expect(toImageGenerationItems('call-1', INPUT, result)[0].warnings).toEqual(['size clamped'])
  })

  it('yields nothing for a failed generation so the caller can fall back', () => {
    const result = JSON.stringify({ status: 'error', message: 'bad request' })
    expect(toImageGenerationItems('call-1', INPUT, result)).toEqual([])
  })

  it('yields nothing when the result is not valid json', () => {
    expect(toImageGenerationItems('call-1', INPUT, 'not json')).toEqual([])
  })

  it('accepts a raw codex arguments value that is not an object', () => {
    const items = toImageGenerationItems('call-1', 'garbage', RESULT)
    expect(items).toHaveLength(1)
    expect(items[0].revisedPrompt).toBeUndefined()
    expect(items[0].savedPath).toBe('/tmp/out/36bd5ca1-0.jpg')
  })

})

const codexCall = (over: Partial<CodexMcpToolCallItem> = {}): CodexMcpToolCallItem => ({
  id: 'exec-e2af1f73',
  type: 'mcp_tool_call',
  server: 'superone',
  tool: 'media_generate_image',
  arguments: INPUT,
  result: { content: [{ type: 'text', text: RESULT }], structuredContent: null },
  status: 'completed',
  ...over,
})

describe('collecting generated images from a codex turn', () => {
  it('surfaces an image for a completed superone media_generate_image call', () => {
    const items = collectCodexGeneratedImages([codexCall()])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      status: 'completed',
      savedPath: '/tmp/out/36bd5ca1-0.jpg',
      revisedPrompt: 'a white baseplate',
    })
  })

  it('shows a placeholder while the call is still running', () => {
    const items = collectCodexGeneratedImages([codexCall({ status: 'in_progress', result: undefined })])
    expect(items).toHaveLength(1)
    expect(items[0].status).toBe('in_progress')
  })

  it('ignores a failed call so the error is not shown as an image', () => {
    expect(collectCodexGeneratedImages([codexCall({ error: { message: 'boom' } })])).toEqual([])
  })

  it('ignores unrelated mcp tool calls and non-tool items', () => {
    const items = collectCodexGeneratedImages([
      codexCall({ tool: 'session_rename' }),
      { id: 'msg-1', type: 'agent_message', text: 'hi' } as unknown as CodexMcpToolCallItem,
    ])
    expect(items).toEqual([])
  })

  it('collects every image across a multi-call turn', () => {
    const items = collectCodexGeneratedImages([
      codexCall({ id: 'exec-1' }),
      codexCall({ id: 'exec-2' }),
    ])
    expect(items.map((i) => i.id)).toEqual(['exec-1-0', 'exec-2-0'])
  })
})
