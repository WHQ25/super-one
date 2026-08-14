import { describe, it, expect } from 'vitest'
import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import {
  toImageGenerationItems,
  toVideoStatusItems,
  isMediaGenerateImageTool,
  isMediaGenerateVideoTool,
  isMediaVideoStatusTool,
  isGrokVideoGenTool,
  collectCodexGeneratedImages,
  collectCodexGeneratedVideos,
  videoGenStatusesFromMessages,
} from './media-generation'
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

  it('matches Grok Build native ImageGen / ImageEdit tool names', () => {
    expect(isMediaGenerateImageTool('ImageGen')).toBe(true)
    expect(isMediaGenerateImageTool('ImageEdit')).toBe(true)
    expect(isMediaGenerateImageTool('image_gen')).toBe(true)
    expect(isMediaGenerateImageTool('image_edit')).toBe(true)
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
    expect(isHiddenToolBlock('mcp__superone__session_list_agents', ERROR_RESULT)).toBe(true)
    expect(isHiddenToolBlock('mcp__superone__miniapp_list', ERROR_RESULT)).toBe(true)
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

describe('mapping Grok native image_gen results to gallery items', () => {
  const GROK_TYPED = JSON.stringify({
    type: 'ImageGen',
    path: '/Users/me/.grok/sessions/s/images/1.jpg',
    filename: '1.jpg',
    session_folder: 'images',
  })
  const GROK_PROMPT_TEXT = JSON.stringify({
    path: '/Users/me/.grok/sessions/s/images/2.jpg',
    filename: '2.jpg',
    session_folder: 'images',
    message: 'Image generated and saved to /Users/me/.grok/sessions/s/images/2.jpg. Do not read or re-display it.',
  })
  const GROK_NORMALIZED = JSON.stringify({
    status: 'generated',
    savedPaths: ['/Users/me/.grok/sessions/s/images/3.jpg'],
    provider: 'grok',
  })

  it('maps typed MediaGenOutput raw_output into a completed gallery item', () => {
    const items = toImageGenerationItems('ig-1', { prompt: 'a test image' }, GROK_TYPED)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'image_generation',
      status: 'completed',
      savedPath: '/Users/me/.grok/sessions/s/images/1.jpg',
      revisedPrompt: 'a test image',
    })
  })

  it('maps Grok prompt_text JSON into a completed gallery item', () => {
    const items = toImageGenerationItems('ig-2', { prompt: 'cat' }, GROK_PROMPT_TEXT)
    expect(items[0]?.savedPath).toBe('/Users/me/.grok/sessions/s/images/2.jpg')
  })

  it('maps ACP-normalized superone-shaped Grok results', () => {
    const items = toImageGenerationItems('ig-3', { prompt: 'dog' }, GROK_NORMALIZED)
    expect(items[0]?.savedPath).toBe('/Users/me/.grok/sessions/s/images/3.jpg')
  })

  it('hides the ImageGen tool block when the gallery will show the image', () => {
    expect(isHiddenToolBlock('ImageGen', GROK_TYPED)).toBe(true)
    expect(isHiddenToolBlock('ImageGen', GROK_NORMALIZED)).toBe(true)
  })

  it('keeps the ImageGen tool block visible on plain error text', () => {
    expect(isHiddenToolBlock('ImageGen', 'Image generation is a SuperGrok feature')).toBe(false)
  })
})

describe('mapping Grok native video results to gallery items', () => {
  const GROK_VIDEO_TYPED = JSON.stringify({
    type: 'ImageToVideo',
    path: '/Users/me/.grok/sessions/s/videos/1.mp4',
    filename: '1.mp4',
    session_folder: 'videos',
  })
  const GROK_VIDEO_NORMALIZED = JSON.stringify({
    status: 'generated',
    savedPaths: ['/Users/me/.grok/sessions/s/videos/1.mp4'],
    provider: 'grok',
  })

  it('recognizes Grok video tool names', () => {
    expect(isGrokVideoGenTool('ImageToVideo')).toBe(true)
    expect(isGrokVideoGenTool('image_to_video')).toBe(true)
    expect(isGrokVideoGenTool('ReferenceToVideo')).toBe(true)
    expect(isGrokVideoGenTool('ImageGen')).toBe(false)
  })

  it('maps typed and ACP-normalized results into completed video cards', () => {
    expect(toVideoStatusItems(GROK_VIDEO_TYPED)).toEqual([
      {
        id: '/Users/me/.grok/sessions/s/videos/1.mp4',
        type: 'video_generation',
        status: 'completed',
        savedPath: '/Users/me/.grok/sessions/s/videos/1.mp4',
      },
    ])
    expect(toVideoStatusItems(GROK_VIDEO_NORMALIZED)[0]?.savedPath).toBe(
      '/Users/me/.grok/sessions/s/videos/1.mp4',
    )
  })

  it('hides the Grok video tool block when the gallery will show the file', () => {
    expect(isHiddenToolBlock('ImageToVideo', GROK_VIDEO_TYPED)).toBe(true)
    expect(isHiddenToolBlock('image_to_video', GROK_VIDEO_NORMALIZED)).toBe(true)
  })

  it('keeps the Grok video tool block visible on failure text', () => {
    expect(isHiddenToolBlock('ImageToVideo', 'Video generation failed')).toBe(false)
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

  it('carries distinct previewPaths onto gallery items for large outputs', () => {
    const result = JSON.stringify({
      status: 'generated',
      savedPaths: ['/tmp/a.png', '/tmp/b.png'],
      previewPaths: ['/tmp/a.preview.jpg', '/tmp/b.preview.jpg'],
    })
    const items = toImageGenerationItems('call-1', INPUT, result)
    expect(items.map((i) => i.savedPath)).toEqual(['/tmp/a.png', '/tmp/b.png'])
    expect(items.map((i) => i.previewPath)).toEqual(['/tmp/a.preview.jpg', '/tmp/b.preview.jpg'])
  })

  it('omits previewPath when it equals the original (small images)', () => {
    const result = JSON.stringify({
      status: 'generated',
      savedPaths: ['/tmp/a.jpg'],
      previewPaths: ['/tmp/a.jpg'],
    })
    const items = toImageGenerationItems('call-1', INPUT, result)
    expect(items[0].savedPath).toBe('/tmp/a.jpg')
    expect(items[0].previewPath).toBeUndefined()
  })

  it('tolerates missing previewPaths for older tool results', () => {
    const items = toImageGenerationItems('call-1', INPUT, RESULT)
    expect(items[0].savedPath).toBe('/tmp/out/36bd5ca1-0.jpg')
    expect(items[0].previewPath).toBeUndefined()
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

const VIDEO_TOOL = 'mcp__superone__media_generate_video'
const STATUS_TOOL = 'mcp__superone__media_video_status'

const SUBMITTED = JSON.stringify({
  status: 'submitted',
  generationId: 'vid-1',
  provider: 'Volcengine Ark',
  model: 'doubao-seedance-2-0-260128',
})

const RUNNING = JSON.stringify({ status: 'running', generationId: 'vid-1' })

const GENERATED = JSON.stringify({
  status: 'generated',
  generationId: 'vid-1',
  savedPaths: ['/tmp/out/vid-1-0.mp4'],
})

describe('video generation tool identification', () => {
  it('tells the two video tools apart from each other and from the image tool', () => {
    expect(isMediaGenerateVideoTool(VIDEO_TOOL)).toBe(true)
    expect(isMediaVideoStatusTool(STATUS_TOOL)).toBe(true)
    expect(isMediaGenerateVideoTool(STATUS_TOOL)).toBe(false)
    expect(isMediaGenerateImageTool(VIDEO_TOOL)).toBe(false)
  })

  it('rejects a same-named tool from a different mcp server', () => {
    expect(isMediaGenerateVideoTool('mcp__other__media_generate_video')).toBe(false)
  })
})

describe('suppressing raw video tool blocks', () => {
  it('keeps the submit block visible as the only progress affordance while rendering', () => {
    expect(isHiddenToolBlock(VIDEO_TOOL, SUBMITTED)).toBe(false)
    expect(isHiddenToolBlock(VIDEO_TOOL, undefined)).toBe(false)
  })

  it('hides an in-flight status poll because it carries no news', () => {
    expect(isHiddenToolBlock(STATUS_TOOL, RUNNING)).toBe(true)
    expect(isHiddenToolBlock(STATUS_TOOL, undefined)).toBe(true)
  })

  it('hides a completed status poll because the gallery renders the video', () => {
    expect(isHiddenToolBlock(STATUS_TOOL, GENERATED)).toBe(true)
  })

  it('shows a failed status poll so the reason reaches the user', () => {
    expect(isHiddenToolBlock(STATUS_TOOL, ERROR_RESULT)).toBe(false)
  })
})

describe('toVideoStatusItems', () => {
  it('emits nothing while the job is still running so no empty card appears', () => {
    expect(toVideoStatusItems(RUNNING)).toEqual([])
    expect(toVideoStatusItems(undefined)).toEqual([])
  })

  it('emits nothing on failure, leaving the visible error block to explain', () => {
    expect(toVideoStatusItems(ERROR_RESULT)).toEqual([])
  })

  it('maps a finished job onto one completed card keyed by generation id', () => {
    expect(toVideoStatusItems(GENERATED)).toEqual([
      { id: 'vid-1', type: 'video_generation', status: 'completed', savedPath: '/tmp/out/vid-1-0.mp4' },
    ])
  })

  it('carries warnings through so unsupported settings stay visible', () => {
    const withWarnings = JSON.stringify({
      status: 'generated',
      generationId: 'vid-2',
      savedPaths: ['/tmp/out/v.mp4'],
      warnings: [{ type: 'unsupported', feature: 'fps' }],
    })
    expect(toVideoStatusItems(withWarnings)[0].warnings).toHaveLength(1)
  })

  it('survives a result that is not json rather than throwing mid-render', () => {
    expect(toVideoStatusItems('not json at all')).toEqual([])
  })
})

const codexVideoCall = (over: Partial<CodexMcpToolCallItem> = {}): CodexMcpToolCallItem => ({
  id: 'exec-video-1',
  type: 'mcp_tool_call',
  server: 'superone',
  tool: 'media_video_status',
  arguments: { generation_id: 'vid-1' },
  result: { content: [{ type: 'text', text: GENERATED }], structuredContent: null },
  status: 'completed',
  ...over,
})

describe('videoGenStatusesFromMessages', () => {
  it('rebuilds a completed job from the submit + finishing poll so restore matches live UI', () => {
    const messages = [{
      content: [
        { type: 'tool_use' as const, toolUseId: 's1', toolName: VIDEO_TOOL, input: JSON.stringify({ prompt: 'a puppy', provider: 'ark', model: 'seedance' }) },
        { type: 'tool_result' as const, toolUseId: 's1', summary: SUBMITTED },
        { type: 'tool_use' as const, toolUseId: 'p1', toolName: STATUS_TOOL, input: JSON.stringify({ generation_id: 'vid-1' }) },
        { type: 'tool_result' as const, toolUseId: 'p1', summary: GENERATED },
      ],
    }]
    expect(videoGenStatusesFromMessages(messages)).toEqual({
      'vid-1': {
        status: 'generated',
        generationId: 'vid-1',
        prompt: 'a puppy',
        provider: 'ark',
        model: 'seedance',
        savedPaths: ['/tmp/out/vid-1-0.mp4'],
      },
    })
  })

  it('keeps a submit-only turn as submitted when the poll has not landed', () => {
    const messages = [{
      content: [
        { type: 'tool_use' as const, toolUseId: 's1', toolName: VIDEO_TOOL, input: JSON.stringify({ prompt: 'x' }) },
        { type: 'tool_result' as const, toolUseId: 's1', summary: SUBMITTED },
      ],
    }]
    expect(videoGenStatusesFromMessages(messages)['vid-1']?.status).toBe('submitted')
  })
})

describe('collecting generated videos from a codex turn', () => {
  it('surfaces the finished video so it lands in the turn gallery like the claude path', () => {
    const items = collectCodexGeneratedVideos([codexVideoCall()])
    expect(items).toEqual([
      { id: 'vid-1', type: 'video_generation', status: 'completed', savedPath: '/tmp/out/vid-1-0.mp4' },
    ])
  })

  it('emits nothing for the submit call or an in-flight poll, leaving the tool block as the progress affordance', () => {
    const items = collectCodexGeneratedVideos([
      codexVideoCall({ id: 'exec-submit', tool: 'media_generate_video', result: { content: [{ type: 'text', text: SUBMITTED }], structuredContent: null } }),
      codexVideoCall({ id: 'exec-poll', result: { content: [{ type: 'text', text: RUNNING }], structuredContent: null } }),
    ])
    expect(items).toEqual([])
  })

  it('ignores a failed poll so the error block explains instead of an empty card', () => {
    expect(collectCodexGeneratedVideos([codexVideoCall({ error: { message: 'boom' } })])).toEqual([])
  })

  it('dedupes repeated polls of the same generation onto one card', () => {
    const items = collectCodexGeneratedVideos([
      codexVideoCall({ id: 'exec-poll-1' }),
      codexVideoCall({ id: 'exec-poll-2' }),
    ])
    expect(items).toHaveLength(1)
  })
})
