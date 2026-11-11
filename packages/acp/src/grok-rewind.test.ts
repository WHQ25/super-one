import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  grokPromptIndexForCheckpoint,
  parseGrokRewindPoints,
  requestGrokRewind,
  XAI_REWIND_EXECUTE,
  XAI_REWIND_POINTS,
} from './grok-rewind'

function user(id: string, checkpointId?: string): ChatMessage {
  return {
    id, role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'acp',
    ...(checkpointId ? { checkpointId } : {}),
  }
}

describe('grok rewind', () => {
  it('counts only checkpointed user prompts', () => {
    const messages = [user('u0', 'u0'), user('plain'), user('u1', 'u1')]
    expect(grokPromptIndexForCheckpoint(messages, 'u1')).toBe(1)
    expect(grokPromptIndexForCheckpoint(messages, 'plain')).toBeNull()
  })

  it('reads rewind points in either field shape', () => {
    expect(parseGrokRewindPoints({
      rewind_points: [{ prompt_index: 0, has_file_changes: true, num_file_snapshots: 2 }],
    })).toEqual([{ promptIndex: 0, hasFileChanges: true, numFileSnapshots: 2 }])
  })

  it('previews placeholder files and executes with force', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === `_${XAI_REWIND_POINTS}`) {
        return { rewindPoints: [{ promptIndex: 1, hasFileChanges: true, numFileSnapshots: 1 }] }
      }
      return { success: true, revertedFiles: ['src/app.ts'] }
    })
    await expect(requestGrokRewind(request, 'sess', 1, 'preview')).resolves.toEqual({
      canRewind: true, supportsCodeOnly: true, filesChanged: ['file-1'],
    })
    await expect(requestGrokRewind(request, 'sess', 1, 'files_only')).resolves.toEqual({
      canRewind: true, supportsCodeOnly: true, filesChanged: ['src/app.ts'],
    })
    expect(request).toHaveBeenLastCalledWith(`_${XAI_REWIND_EXECUTE}`, {
      sessionId: 'sess', targetPromptIndex: 1, force: true, mode: 'files_only',
    })
  })
})
