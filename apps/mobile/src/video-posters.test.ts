import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadVideoPosterResponse, RemoteCommand } from '@superone/shared/agent-types'
import { loadVideoPoster, resetVideoPosterCache, type VideoPosterHost } from './video-posters'

const CUT: ReadVideoPosterResponse = {
  ok: true, name: 'clip.mp4', mimeType: 'video/mp4', size: 4096, modifiedAt: 1,
  poster: { base64: 'ZnJhbWU=', mimeType: 'image/jpeg', width: 512, height: 288, durationMs: 27_051 },
}

function host(answer: (command: RemoteCommand) => unknown): VideoPosterHost & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(async (command: RemoteCommand) => answer(command)) }
}

const base = { projectPath: '/proj', sessionId: 's1', path: 'out/clip.mp4' }

beforeEach(() => resetVideoPosterCache())

describe('loadVideoPoster', () => {
  it('asks the host for the frame by resolved path and hands back a data URI with the badge facts', async () => {
    const h = host(() => CUT)
    await expect(loadVideoPoster({ ...base, host: h })).resolves.toEqual({
      dataUri: 'data:image/jpeg;base64,ZnJhbWU=', width: 512, height: 288, durationMs: 27_051,
    })
    expect(h.request.mock.calls[0][0]).toMatchObject({ type: 'read_video_poster', path: '/proj/out/clip.mp4', projectPath: '/proj', sessionId: 's1' })
  })

  it('answers from memory the second time, for a cut frame and for a clip the host gave up on', async () => {
    const h = host((command) => ((command as { path: string }).path.endsWith('.mkv') ? { ...CUT, poster: null } : CUT))
    await loadVideoPoster({ ...base, host: h })
    await loadVideoPoster({ ...base, host: h })
    await expect(loadVideoPoster({ ...base, host: h, path: 'out/odd.mkv' })).resolves.toBeNull()
    await expect(loadVideoPoster({ ...base, host: h, path: 'out/odd.mkv' })).resolves.toBeNull()
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('throws on a host error or a host too old to know the command, so the tile keeps its chip', async () => {
    await expect(loadVideoPoster({ ...base, host: host(() => ({ ok: false, error: 'not_found' })) })).rejects.toThrow('not_found')
    await expect(loadVideoPoster({ ...base, host: host(() => ({ error: 'unknown command' })) })).rejects.toThrow('host cannot cut video posters')
  })
})
