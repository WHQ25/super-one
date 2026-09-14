import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { ADHOC_SESSION_ID, producerDir } from '../media-output-paths'
import { collectArtifacts, resetArtifactRegistry, takeArtifacts } from '../mcp/artifact-registry'
import {
  actionRecordingDir,
  adoptActionRecording,
  createActionRecordingPath,
  persistActionRecording,
} from './action-recording-store'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'recording-store-'))
  state.userData = root
  resetArtifactRegistry()
})

describe('action recording storage', () => {
  it('writes a session recording into that session sync zone, partitioned by action target', () => {
    // The agent is handed this path; on a remote node it only resolves if the
    // file is in the zone (docs/design/session-sync-zone.md §6).
    expect(actionRecordingDir('s1', 'web')).toBe(join(producerDir('s1', 'recording'), 'web'))
    expect(createActionRecordingPath('s1', 'computer', 'mp4'))
      .toMatch(new RegExp(`^${join(producerDir('s1', 'recording'), 'computer').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[0-9a-f-]+\\.mp4$`))
  })

  it('files a recording taken outside any session under adhoc', () => {
    expect(actionRecordingDir(null, 'device')).toBe(join(producerDir(ADHOC_SESSION_ID, 'recording'), 'device'))
  })

  it('registers a persisted recording so the host action pushes it to the node', () => {
    const saved = collectArtifacts('s1', 'call-1', async () =>
      persistActionRecording('s1', 'web', Buffer.from('webm bytes').toString('base64'), 'video/webm'))
    return saved.then((path) => {
      expect(path).not.toBeNull()
      expect(readFileSync(path!, 'utf8')).toBe('webm bytes')
      expect(takeArtifacts('s1', 'call-1')).toEqual([{ path, producer: 'recording', final: true }])
    })
  })

  it('registers a device recording adopted from the surface capture', async () => {
    const source = join(root, 'capture.mp4')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(source, 'mp4 bytes')
    const recording = await collectArtifacts('s1', 'call-2', async () =>
      adoptActionRecording('s1', 'device', source, Date.now() - 1000))
    expect(recording.savedPath.startsWith(producerDir('s1', 'recording'))).toBe(true)
    expect(recording.mimeType).toBe('video/mp4')
    expect(takeArtifacts('s1', 'call-2')).toEqual([{ path: recording.savedPath, producer: 'recording', final: true }])
  })
})
