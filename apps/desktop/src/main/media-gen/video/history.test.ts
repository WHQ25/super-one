import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaGenerationEntry, MediaGenerationRow } from '../../db-media-generations'

/**
 * The sqlite layer is mocked rather than exercised: better-sqlite3 is built against Electron's ABI
 * and cannot load under vitest. An in-memory table keeps the read-after-write behaviour this module
 * actually depends on.
 */
const rows = new Map<string, MediaGenerationRow>()

vi.mock('../../db-media-generations', () => ({
  insertMediaGeneration: (row: MediaGenerationRow) => rows.set(row.id, { ...row }),
  updateMediaGeneration: (
    id: string,
    patch: { status: string; resultPaths?: string[]; error?: string | null; warnings?: unknown[] },
  ) => {
    const row = rows.get(id)
    if (!row) return
    rows.set(id, {
      ...row,
      status: patch.status as MediaGenerationRow['status'],
      result_paths_json: patch.resultPaths ? JSON.stringify(patch.resultPaths) : row.result_paths_json,
      warnings_json: patch.warnings ? JSON.stringify(patch.warnings) : row.warnings_json,
      error: patch.error ?? null,
    })
  },
  getMediaGeneration: (id: string): MediaGenerationEntry | null => {
    const row = rows.get(id)
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.session_id,
      source: row.source,
      providerId: row.provider_id,
      model: row.model,
      mediaType: row.media_type,
      prompt: row.prompt,
      resultPaths: row.result_paths_json ? (JSON.parse(row.result_paths_json) as string[]) : [],
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    }
  },
}))

vi.mock('../paths', () => ({ mediaGenOutputDir: () => '/tmp/out' }))

vi.mock('../providers', () => ({
  resolveVideoProvider: vi.fn(async () => ({ id: 'cred', kind: 'ark', apiKey: 'k', baseURL: 'https://x' })),
}))

const generateVideoMedia = vi.fn()
vi.mock('./service', () => ({ generateVideoMedia: (...args: unknown[]) => generateVideoMedia(...args) }))

const { submitVideoGeneration, readVideoGeneration, cancelVideoGeneration } = await import('./history')

/** Lets the background promise chain settle without coupling the test to its internals. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

const PARAMS = { providerId: 'cred', model: 'seedance', prompt: 'a cat', source: 'agent' as const }

describe('video generation history', () => {
  beforeEach(() => {
    rows.clear()
    generateVideoMedia.mockReset()
  })

  it('records the row and returns before the video is finished', async () => {
    let finish: (value: unknown) => void = () => {}
    generateVideoMedia.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    const id = await submitVideoGeneration(PARAMS)

    expect(readVideoGeneration(id)).toMatchObject({ status: 'running', savedPaths: [] })
    expect(rows.get(id)?.media_type).toBe('video')

    finish({ images: [{ path: '/tmp/out/v.mp4', mediaType: 'video/mp4' }], warnings: [] })
    await settle()
    expect(readVideoGeneration(id)).toMatchObject({ status: 'succeeded', savedPaths: ['/tmp/out/v.mp4'] })
  })

  it('keeps one row across both phases rather than inserting a second', async () => {
    generateVideoMedia.mockResolvedValue({ images: [{ path: '/tmp/out/v.mp4' }], warnings: [] })
    const id = await submitVideoGeneration(PARAMS)
    await settle()
    expect(rows.size).toBe(1)
    expect(rows.get(id)?.status).toBe('succeeded')
  })

  it('settles the row to failed with the upstream message', async () => {
    generateVideoMedia.mockRejectedValue(new Error('content filtered'))
    const id = await submitVideoGeneration(PARAMS)
    await settle()
    expect(readVideoGeneration(id)).toMatchObject({ status: 'failed', error: 'content filtered' })
  })

  it('reports an interrupted job instead of polling a stale running row forever', async () => {
    generateVideoMedia.mockReturnValue(new Promise(() => {}))
    const id = await submitVideoGeneration(PARAMS)

    // Simulate a restart: the row survives, the in-process job map does not.
    vi.resetModules()
    const reloaded = await import('./history')

    const state = reloaded.readVideoGeneration(id)
    expect(state).toMatchObject({ status: 'failed' })
    expect(state?.error).toMatch(/restart/i)
    // The row is settled, so a second read stays failed rather than re-reporting.
    expect(reloaded.readVideoGeneration(id)?.status).toBe('failed')
  })

  it('returns null for an unknown generation id', () => {
    expect(readVideoGeneration('nope')).toBeNull()
  })

  it('aborts a running job and reports nothing to cancel once it has settled', async () => {
    let signal: AbortSignal | undefined
    generateVideoMedia.mockImplementation((params: { abortSignal?: AbortSignal }) => {
      signal = params.abortSignal
      return new Promise(() => {})
    })
    const id = await submitVideoGeneration(PARAMS)

    expect(cancelVideoGeneration(id)).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(cancelVideoGeneration('other')).toBe(false)
  })
})
