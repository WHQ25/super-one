import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { getPath: vi.fn(() => '/tmp') } }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { mockSubmitVideoGeneration, mockGetMediaProviderStatuses } = vi.hoisted(() => ({
  mockSubmitVideoGeneration: vi.fn(),
  mockGetMediaProviderStatuses: vi.fn(),
}))

vi.mock('../media-gen/providers', () => ({
  resolveDefaultModel: vi.fn(async () => 'seedream-4.0'),
  resolveDefaultProviderId: vi.fn(async () => 'cred-ark'),
  resolveDefaultVideoModel: vi.fn(async () => 'seedance-1.0'),
  resolveDefaultVideoProviderId: vi.fn(async () => 'cred-ark'),
}))
vi.mock('../media-gen/settings-service', () => ({
  getMediaProviderStatuses: mockGetMediaProviderStatuses,
}))
vi.mock('../media-gen/video/history', () => ({
  readVideoGeneration: vi.fn(),
  submitVideoGeneration: mockSubmitVideoGeneration,
}))
vi.mock('../media-gen/history', () => ({ generateAndRecord: vi.fn() }))
vi.mock('../image-cache', () => ({ detectImageMime: vi.fn(() => 'image/png') }))

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VIDEO_GEN_PARAMS_FIELD } from '@superone/shared/agent-types'
import { readMediaGuideHandler, generateVideoToolHandler, type GenerateVideoArgs } from './media-tools'
import { MEDIA_GUIDE_TOPICS } from './superone-mcp-builtin-defs'

function makeProviderStatuses() {
  return [
    {
      id: 'cred-ark',
      label: 'Volcengine Ark',
      providerLabel: 'Volcengine',
      kind: 'ark',
      categories: ['video'],
      defaultModel: 'seedance-1.0',
      models: [{ id: 'seedance-1.0', label: 'Seedance 1.0' }],
      hasKey: true,
      hasEnvKey: false,
    },
  ]
}

/** Minimal fake of the McpServer wrapper exposing the underlying SDK Server. */
function makeServerStub(elicitInput: ReturnType<typeof vi.fn>): McpServer {
  return { server: { elicitInput } } as unknown as McpServer
}

const BASE_ARGS: GenerateVideoArgs = { prompt: 'a cat walks through neon city' }
const DEPS = { notifyDevAppReady: vi.fn(), sessionId: 'sess-test', sessionHost: null }

describe('readMediaGuideHandler', () => {
  it('returns non-empty, distinct content for every declared topic', () => {
    const seen = new Set<string>()
    for (const topic of MEDIA_GUIDE_TOPICS) {
      const result = readMediaGuideHandler({ topic })
      const text = result.content[0].text
      expect(text.length, `${topic} guide content`).toBeGreaterThan(0)
      expect(seen.has(text), `${topic} guide duplicates another topic's content`).toBe(false)
      seen.add(text)
    }
  })

  it('throws on an unknown topic instead of returning empty content', () => {
    expect(() => readMediaGuideHandler({ topic: 'not-a-real-topic' })).toThrow(/Unknown media guide topic/)
  })
})

describe('generateVideoToolHandler confirmation gate', () => {
  beforeEach(() => {
    mockSubmitVideoGeneration.mockReset()
    mockGetMediaProviderStatuses.mockReset()
  })

  it('elicits confirmation and submits with edited params on accept', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    mockSubmitVideoGeneration.mockResolvedValue('gen-123')
    const elicitInput = vi.fn(async () => ({
      action: 'accept',
      content: {
        [VIDEO_GEN_PARAMS_FIELD]: JSON.stringify({
          prompt: 'edited: two cats',
          provider: 'cred-ark',
          model: 'seedance-1.0',
          aspectRatio: '9:16',
          resolution: '1080p',
          duration: 10,
          generateAudio: true,
          watermark: false,
          cameraFixed: true,
        }),
      },
    }))

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, DEPS, makeServerStub(elicitInput))

    expect(elicitInput).toHaveBeenCalledTimes(1)
    const [elicitArgs] = elicitInput.mock.calls[0]
    expect(elicitArgs.mode).toBe('form')
    expect(elicitArgs.message).toContain('a cat walks through neon city')
    // Payload must travel in the paramsJson field description (top-level custom keys get stripped)
    const description = elicitArgs.requestedSchema.properties[VIDEO_GEN_PARAMS_FIELD].description
    const payload = JSON.parse(description)
    expect(payload.params.prompt).toBe('a cat walks through neon city')
    expect(payload.params.provider).toBe('cred-ark')
    expect(payload.providers).toHaveLength(1)

    // Edited params applied to the actual submission
    expect(mockSubmitVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'cred-ark',
        model: 'seedance-1.0',
        prompt: 'edited: two cats',
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 10,
        generateAudio: true,
        sessionId: 'sess-test',
        source: 'agent',
      }),
    )
    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('submitted')
    expect(text.generationId).toBe('gen-123')
  })

  it('returns rejected tool_result with feedback on decline, without submitting', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    const elicitInput = vi.fn(async () => ({
      action: 'decline',
      content: { feedback: 'duration too long' },
    }))

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, DEPS, makeServerStub(elicitInput))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('rejected')
    expect(text.feedback).toBe('duration too long')
    expect(text.hint).toContain('media_generate_video')
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('returns cancelled tool_result on cancel, without submitting', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    const elicitInput = vi.fn(async () => ({ action: 'cancel' }))

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, DEPS, makeServerStub(elicitInput))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('cancelled')
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('fails closed with an explanatory error when elicitation is unsupported', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    const elicitInput = vi.fn(async () => {
      throw new Error('Client does not support form elicitation.')
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, DEPS, makeServerStub(elicitInput))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('error')
    expect(text.message).toContain('elicitation')
    expect(text.hint).toContain('Do NOT retry')
    // Fail-closed: an unreviewed expensive generation must never go out the door.
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('proceeds without confirmation when no server is available (Codex stdio path)', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    mockSubmitVideoGeneration.mockResolvedValue('gen-789')

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, DEPS, undefined)

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('submitted')
    expect(mockGetMediaProviderStatuses).not.toHaveBeenCalled()
  })

  it('keeps original params when accept content has no paramsJson (auto-accept path)', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    mockSubmitVideoGeneration.mockResolvedValue('gen-auto')
    const elicitInput = vi.fn(async () => ({ action: 'accept', content: null }))

    const result = await generateVideoToolHandler({ ...BASE_ARGS, duration: 8 }, DEPS, makeServerStub(elicitInput))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('submitted')
    expect(mockSubmitVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({ duration: 8 }))
  })
})
