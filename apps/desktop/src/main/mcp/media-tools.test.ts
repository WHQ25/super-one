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

import type { AgentEvent, PermissionRequest } from '@superone/shared/agent-types'
import { VIDEO_GEN_PARAMS_FIELD } from '@superone/shared/agent-types'
import {
  readMediaGuideHandler,
  generateVideoToolHandler,
  resolveVideoConfirm,
  rejectVideoConfirm,
  type GenerateVideoArgs,
} from './media-tools'
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

type ConfirmResponder = (request: PermissionRequest) => void

/**
 * Session host whose emitHostEvent answers the confirm request the way the renderer would.
 * `respond` runs on the next tick so the awaiting handler is genuinely suspended first.
 */
function makeSessionHost(respond: ConfirmResponder) {
  const emitted: PermissionRequest[] = []
  const sessionHost = {
    getSession: () => ({
      emitHostEvent: (event: AgentEvent) => {
        if (event.type !== 'permission_request') return
        emitted.push(event.request)
        queueMicrotask(() => respond(event.request))
      },
    }),
  }
  return { sessionHost: sessionHost as never, emitted }
}

const BASE_ARGS: GenerateVideoArgs = { prompt: 'a cat walks through neon city' }

function makeDeps(sessionHost: unknown) {
  return { notifyDevAppReady: vi.fn(), sessionId: 'sess-test', sessionHost: sessionHost as never }
}

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

  it('asks the user to confirm and submits with the edited params on accept', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    mockSubmitVideoGeneration.mockResolvedValue('gen-123')
    const { sessionHost, emitted } = makeSessionHost((req) => {
      resolveVideoConfirm(req.requestId, 'accept', {
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
      })
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, makeDeps(sessionHost))

    expect(emitted).toHaveLength(1)
    expect(emitted[0].requestKind).toBe('video_gen_confirm')
    expect(emitted[0].message).toContain('a cat walks through neon city')
    expect(emitted[0].videoGenConfirm?.params.prompt).toBe('a cat walks through neon city')
    expect(emitted[0].videoGenConfirm?.params.provider).toBe('cred-ark')
    expect(emitted[0].videoGenConfirm?.providers).toHaveLength(1)

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
    const { sessionHost } = makeSessionHost((req) => {
      resolveVideoConfirm(req.requestId, 'decline', { feedback: 'duration too long' })
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, makeDeps(sessionHost))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('rejected')
    expect(text.feedback).toBe('duration too long')
    expect(text.hint).toContain('media_generate_video')
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('returns cancelled tool_result on cancel, without submitting', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    const { sessionHost } = makeSessionHost((req) => {
      resolveVideoConfirm(req.requestId, 'cancel')
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, makeDeps(sessionHost))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('cancelled')
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('fails closed with an explanatory error when the confirm request is aborted', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    const { sessionHost } = makeSessionHost((req) => {
      rejectVideoConfirm(req.requestId, 'Session closed')
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, makeDeps(sessionHost))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('error')
    expect(text.message).toContain('Session closed')
    expect(text.hint).toContain('Do NOT retry')
    // Fail-closed: an unreviewed expensive generation must never go out the door.
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('still gates the Codex stdio path, which executes the tool without an McpServer in hand', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    mockSubmitVideoGeneration.mockResolvedValue('gen-789')
    const { sessionHost, emitted } = makeSessionHost((req) => {
      resolveVideoConfirm(req.requestId, 'accept')
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, makeDeps(sessionHost))

    expect(emitted).toHaveLength(1)
    expect(JSON.parse(result.content[0].text).status).toBe('submitted')
  })

  it('fails closed when the session cannot host a confirm dialog at all', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())

    const result = await generateVideoToolHandler({ ...BASE_ARGS }, makeDeps(null))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('error')
    expect(mockSubmitVideoGeneration).not.toHaveBeenCalled()
  })

  it('keeps original params when accept content has no paramsJson (auto-accept path)', async () => {
    mockGetMediaProviderStatuses.mockResolvedValue(makeProviderStatuses())
    mockSubmitVideoGeneration.mockResolvedValue('gen-auto')
    const { sessionHost } = makeSessionHost((req) => {
      resolveVideoConfirm(req.requestId, 'accept')
    })

    const result = await generateVideoToolHandler({ ...BASE_ARGS, duration: 8 }, makeDeps(sessionHost))

    const text = JSON.parse(result.content[0].text)
    expect(text.status).toBe('submitted')
    expect(mockSubmitVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({ duration: 8 }))
  })
})
