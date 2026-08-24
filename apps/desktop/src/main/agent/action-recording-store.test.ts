import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userData') },
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    chmodSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

import {
  actionRecordingDir,
  createActionRecordingPath,
} from './action-recording-store'

describe('action recording storage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('partitions recordings by action target', () => {
    expect(actionRecordingDir()).toBe('/userData/recordings')
    expect(actionRecordingDir('web')).toBe('/userData/recordings/web')
    expect(createActionRecordingPath('computer', 'mp4')).toMatch(
      /^\/userData\/recordings\/computer\/[0-9a-f-]+\.mp4$/,
    )
  })
})
