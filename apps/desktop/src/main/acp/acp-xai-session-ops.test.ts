import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  buildGrokForkParams,
  buildGrokInterjectParams,
  grokForkTargetPromptIndex,
  grokPromptIndexForUserMessage,
  isGrokGoalSlash,
  parseGrokCompactSlash,
  parseGrokForkResponse,
  parseGrokRewindExecute,
  parseGrokRewindPoints,
  parseGrokSessionInterjection,
  rewindPreviewFromPoints,
  rewindResultFromExecute,
} from './acp-xai-session-ops'

function user(id: string, checkpointId?: string): ChatMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: id }],
    createdAt: '',
    providerId: 'local',
    ...(checkpointId ? { checkpointId } : {}),
  }
}

function assistant(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: id }],
    createdAt: '',
    providerId: 'local',
  }
}

describe('isGrokGoalSlash', () => {
  it('matches /goal and its subcommands', () => {
    expect(isGrokGoalSlash('/goal')).toBe(true)
    expect(isGrokGoalSlash('  /goal pause  ')).toBe(true)
    expect(isGrokGoalSlash('/GOAL clear')).toBe(true)
    expect(isGrokGoalSlash('/goal Ship the login flow')).toBe(true)
  })

  it('does not match other slashes or embedded /goal', () => {
    expect(isGrokGoalSlash('/goalie')).toBe(false)
    expect(isGrokGoalSlash('/compact')).toBe(false)
    expect(isGrokGoalSlash('please /goal pause')).toBe(false)
  })
})

describe('parseGrokCompactSlash', () => {
  it('matches bare /compact', () => {
    expect(parseGrokCompactSlash('/compact')).toEqual({})
    expect(parseGrokCompactSlash('  /compact  ')).toEqual({})
  })

  it('captures trailing user context', () => {
    expect(parseGrokCompactSlash('/compact keep the auth notes')).toEqual({
      userContext: 'keep the auth notes',
    })
  })

  it('does not match other slashes', () => {
    expect(parseGrokCompactSlash('/compaction')).toBeNull()
    expect(parseGrokCompactSlash('/compact-mode')).toBeNull()
    expect(parseGrokCompactSlash('compact')).toBeNull()
  })
})

describe('parseGrokSessionInterjection', () => {
  it('reads camelCase wire', () => {
    expect(parseGrokSessionInterjection({
      sessionId: 's1',
      text: 'steer left',
      interjectionId: 'i1',
    })).toEqual({ sessionId: 's1', text: 'steer left', interjectionId: 'i1' })
  })

  it('requires text', () => {
    expect(parseGrokSessionInterjection({ sessionId: 's1' })).toBeNull()
  })
})

describe('buildGrokInterjectParams', () => {
  it('omits content for text-only (legacy wire)', () => {
    expect(buildGrokInterjectParams('s1', 'hi', 'i1')).toEqual({
      sessionId: 's1',
      text: 'hi',
      interjectionId: 'i1',
    })
  })

  it('adds content blocks when images are present', () => {
    const params = buildGrokInterjectParams('s1', 'look', 'i1', [
      { mimeType: 'image/png', base64: 'aGVsbG8=', name: 'x.png' },
    ])
    expect(params.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ])
  })
})

describe('rewind points / execute', () => {
  it('parses rewind/points and builds a dry-run preview', () => {
    const points = parseGrokRewindPoints({
      rewindPoints: [
        { promptIndex: 0, hasFileChanges: false, numFileSnapshots: 0 },
        { promptIndex: 2, hasFileChanges: true, numFileSnapshots: 3 },
      ],
    })
    expect(rewindPreviewFromPoints(points, 2)).toEqual({
      canRewind: true,
      supportsCodeOnly: true,
      filesChanged: ['file-1', 'file-2', 'file-3'],
    })
    expect(rewindPreviewFromPoints(points, 0).filesChanged).toEqual([])
    expect(rewindPreviewFromPoints(points, 9).canRewind).toBe(false)
  })

  it('maps a successful execute onto RewindFilesResult', () => {
    const result = parseGrokRewindExecute({
      success: true,
      mode: 'files_only',
      revertedFiles: ['src/a.ts'],
      cleanFiles: [],
      conflicts: [],
    })
    expect(rewindResultFromExecute(result)).toEqual({
      canRewind: true,
      supportsCodeOnly: true,
      filesChanged: ['src/a.ts'],
    })
  })

  it('treats code_only as files_only and surfaces conflicts', () => {
    const result = parseGrokRewindExecute({
      success: false,
      mode: 'code_only',
      reverted_files: [],
      conflicts: [{ path: 'src/a.ts', conflictType: 'content_mismatch' }],
    })
    expect(result.mode).toBe('files_only')
    expect(rewindResultFromExecute(result).canRewind).toBe(false)
    expect(rewindResultFromExecute(result).filesChanged).toEqual(['src/a.ts'])
  })
})

describe('prompt index mapping', () => {
  const messages = [
    user('u0', 'u0'),
    assistant('a0'),
    user('u1', 'u1'),
    assistant('a1'),
    user('interject'),
    user('u2', 'u2'),
  ]

  it('counts only checkpointed user prompts', () => {
    expect(grokPromptIndexForUserMessage(messages, 'u0')).toBe(0)
    expect(grokPromptIndexForUserMessage(messages, 'u1')).toBe(1)
    expect(grokPromptIndexForUserMessage(messages, 'u2')).toBe(2)
    expect(grokPromptIndexForUserMessage(messages, 'interject')).toBeNull()
  })

  it('forks keep the selected turn (drop from N+1)', () => {
    expect(grokForkTargetPromptIndex(messages, 'a1')).toBe(2)
    expect(grokForkTargetPromptIndex(messages, 'u2')).toBe(3)
    expect(grokForkTargetPromptIndex(messages, 'missing')).toBeUndefined()
  })
})

describe('fork params / response', () => {
  it('builds camelCase fork params', () => {
    expect(buildGrokForkParams({
      sourceSessionId: 'src',
      sourceCwd: '/src',
      newCwd: '/dst',
      targetPromptIndex: 2,
    })).toEqual({
      sourceSessionId: 'src',
      sourceCwd: '/src',
      newCwd: '/dst',
      sessionKind: 'fork',
      targetPromptIndex: 2,
    })
  })

  it('reads newSessionId from a nested result wrapper', () => {
    expect(parseGrokForkResponse({ result: { newSessionId: 'forked' } })).toEqual({
      newSessionId: 'forked',
    })
  })
})
