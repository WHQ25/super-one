import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { RECORDING_ROOT } from '../media-output-paths'

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

  it('partitions recordings by action target under the temp recording root', () => {
    // Same contract as screenshots: temp, OS-pruned, never userData — see media-output-paths.
    expect(actionRecordingDir()).toBe(RECORDING_ROOT)
    expect(actionRecordingDir('web')).toBe(join(RECORDING_ROOT, 'web'))
    expect(createActionRecordingPath('computer', 'mp4')).toMatch(
      new RegExp(`^${join(RECORDING_ROOT, 'computer').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[0-9a-f-]+\\.mp4$`),
    )
  })
})
