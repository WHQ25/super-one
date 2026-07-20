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
      upstreamTaskId: row.upstream_task_id,
    }
  },
}))

vi.mock('../paths', () => ({ mediaGenOutputDir: () => '/tmp/out' }))

vi.mock('../providers', () => ({
  resolveVideoProvider: vi.fn(async () => ({ id: 'cred', kind: 'ark', apiKey: 'k', baseURL: 'https://x' })),
}))

const submitVideoTask = vi.fn()
const fetchVideoTask = vi.fn()
const persistVideoTask = vi.fn()
vi.mock('./service', () => ({
  submitVideoTask: (...args: unknown[]) => submitVideoTask(...args),
  fetchVideoTask: (...args: unknown[]) => fetchVideoTask(...args),
  persistVideoTask: (...args: unknown[]) => persistVideoTask(...args),
}))

const { submitVideoGeneration, readVideoGeneration } = await import('./history')

const PARAMS = { providerId: 'cred', model: 'seedance', prompt: 'a cat', source: 'agent' as const }

describe('video generation history', () => {
  beforeEach(() => {
    rows.clear()
    submitVideoTask.mockReset().mockResolvedValue({ taskId: 'cgt-1', warnings: [] })
    fetchVideoTask.mockReset()
    persistVideoTask.mockReset().mockResolvedValue([{ path: '/tmp/out/v.mp4', mediaType: 'video/mp4' }])
  })

  it('persists the provider task id so a later read can pick the job back up', async () => {
    const id = await submitVideoGeneration(PARAMS)

    expect(rows.get(id)?.upstream_task_id).toBe('cgt-1')
    expect(rows.get(id)?.media_type).toBe('video')
  })

  it('asks the provider only while the row is unsettled', async () => {
    fetchVideoTask.mockResolvedValue({ id: 'cgt-1', status: 'succeeded', videoUrl: 'https://cdn/v.mp4' })
    const id = await submitVideoGeneration(PARAMS)

    await expect(readVideoGeneration(id)).resolves.toMatchObject({
      status: 'succeeded',
      savedPaths: ['/tmp/out/v.mp4'],
    })
    expect(fetchVideoTask).toHaveBeenCalledTimes(1)

    // Settled rows are answered from the table; the provider is not asked again.
    await readVideoGeneration(id)
    expect(fetchVideoTask).toHaveBeenCalledTimes(1)
  })

  it('leaves the row running when the job has not finished, so the next call asks again', async () => {
    fetchVideoTask.mockResolvedValue({ id: 'cgt-1', status: 'running' })
    const id = await submitVideoGeneration(PARAMS)

    await expect(readVideoGeneration(id)).resolves.toMatchObject({ status: 'running', savedPaths: [] })
    await expect(readVideoGeneration(id)).resolves.toMatchObject({ status: 'running' })
    expect(fetchVideoTask).toHaveBeenCalledTimes(2)
    expect(rows.get(id)?.status).toBe('running')
  })

  it('resumes a job submitted before a restart instead of writing it off', async () => {
    fetchVideoTask.mockResolvedValue({ id: 'cgt-1', status: 'succeeded', videoUrl: 'https://cdn/v.mp4' })
    const id = await submitVideoGeneration(PARAMS)

    // Simulate a restart: the row survives, and nothing else has to.
    vi.resetModules()
    const reloaded = await import('./history')

    await expect(reloaded.readVideoGeneration(id)).resolves.toMatchObject({
      status: 'succeeded',
      savedPaths: ['/tmp/out/v.mp4'],
    })
  })

  it('does not settle the row when the provider cannot be reached', async () => {
    fetchVideoTask.mockRejectedValue(new Error('socket hang up'))
    const id = await submitVideoGeneration(PARAMS)

    await expect(readVideoGeneration(id)).rejects.toThrow(/socket hang up/)
    expect(rows.get(id)?.status).toBe('running')
  })

  it('settles the row to failed with the upstream message', async () => {
    fetchVideoTask.mockResolvedValue({ id: 'cgt-1', status: 'failed', error: 'content filtered' })
    const id = await submitVideoGeneration(PARAMS)

    await expect(readVideoGeneration(id)).resolves.toMatchObject({ status: 'failed', error: 'content filtered' })
    expect(rows.get(id)?.status).toBe('failed')
  })

  it('returns null for an unknown generation id', async () => {
    await expect(readVideoGeneration('nope')).resolves.toBeNull()
  })
})
