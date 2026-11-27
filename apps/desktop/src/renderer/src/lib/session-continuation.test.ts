/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { useChatStore } from '@/stores/chat-store'
import { serializeComposerDocument } from '@/components/chat/chat-input/serializeComposerDocument'
import { continuationDraft, handoffToNewSession } from './session-continuation'

describe('continuationDraft', () => {
  it('opens with a mention of the old session and keeps its unsent draft after it', () => {
    const session = {
      ...createDefaultPerSessionState(),
      draftText: 'and fix the tests',
      draftJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'and fix the tests' }] }] },
      mentions: [{ kind: 'file' as const, value: 'src/a.ts', displayName: 'a.ts' }],
    }

    const draft = continuationDraft({ sessionId: 'old', title: 'Refactor', session })

    expect(draft.draftText).toBe('@Refactor and fix the tests')
    expect(draft.draftJson).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { kind: 'session', value: 'old', displayName: 'Refactor' } }, { type: 'text', text: ' ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'and fix the tests' }] },
      ],
    })
    expect(draft.mentions).toEqual([
      { kind: 'session', value: 'old', displayName: 'Refactor' },
      { kind: 'file', value: 'src/a.ts', displayName: 'a.ts' },
    ])
  })

  it('holds only the mention when there was no draft', () => {
    const draft = continuationDraft({ sessionId: 'old', title: 'Refactor', session: createDefaultPerSessionState() })

    expect(draft.draftText).toBe('@Refactor')
    expect((draft.draftJson as { content: unknown[] }).content).toHaveLength(1)
  })
})

describe('handoffToNewSession', () => {
  it('creates a new session in the same workspace with a session mention and optional cutoff', () => {
    const src = {
      ...createDefaultPerSessionState(),
      _title: 'Auth Debug',
      _worktreePath: '/repo/.worktrees/auth',
      _gitBranch: 'feat/auth',
      draftText: 'unsent note',
    }
    useChatStore.setState({
      activeProject: '/repo',
      projectSessions: {
        '/repo': {
          ...createDefaultProjectState(),
          _activeSessionId: 'src-1',
          _sessions: { 'src-1': src },
        },
      },
    })

    const nextId = handoffToNewSession('/repo', 'src-1', 'msg-2')
    expect(nextId).toBeTruthy()

    const state = useChatStore.getState()
    const proj = state.projectSessions['/repo']
    expect(proj._activeSessionId).toBe(nextId)
    const next = proj._sessions[nextId!]
    expect(next.continuesFrom).toBeUndefined()
    expect(next._worktreePath).toBe('/repo/.worktrees/auth')
    expect(next._gitBranch).toBe('feat/auth')
    expect(next.mentions).toEqual([
      { kind: 'session', value: 'src-1', displayName: 'Auth Debug', upToMessageId: 'msg-2' },
    ])
    expect(proj._sessions['src-1'].draftText).toBe('unsent note')

    const serialized = serializeComposerDocument(next.draftJson as any, next.draftText, [])
    expect(serialized.segments).toEqual([
      {
        text: '<superone-session><title>Auth Debug</title><sessionId>src-1</sessionId><upToMessageId>msg-2</upToMessageId></superone-session>',
        isPaste: false,
      },
    ])
  })

  it('omits upToMessageId when handing off from the end of the session', () => {
    const src = {
      ...createDefaultPerSessionState(),
      _title: 'Auth Debug',
    }
    useChatStore.setState({
      activeProject: '/repo',
      projectSessions: {
        '/repo': {
          ...createDefaultProjectState(),
          _activeSessionId: 'src-1',
          _sessions: { 'src-1': src },
        },
      },
    })

    const nextId = handoffToNewSession('/repo', 'src-1')
    const next = useChatStore.getState().projectSessions['/repo']._sessions[nextId!]
    expect(next.mentions).toEqual([
      { kind: 'session', value: 'src-1', displayName: 'Auth Debug' },
    ])

    const serialized = serializeComposerDocument(next.draftJson as any, next.draftText, [])
    expect(serialized.segments).toEqual([
      {
        text: '<superone-session><title>Auth Debug</title><sessionId>src-1</sessionId></superone-session>',
        isPaste: false,
      },
    ])
  })

  it('seeds harness model catalog so model display matches a normal new session', () => {
    const src = {
      ...createDefaultPerSessionState(),
      _title: 'Antigravity Task',
      sessionProvider: 'acp-antigravity' as const,
      preferredProvider: 'acp-antigravity' as const,
      acpAgentId: 'antigravity',
      selectedModel: 'gemini-4-hydrogen',
    }
    const models = [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen (Medium)', description: '' }]
    useChatStore.setState((s) => ({
      activeProject: '/repo',
      harnessResources: {
        ...s.harnessResources,
        'acp-antigravity': {
          agents: [{ id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy --acp' }],
          selectedAgentId: 'antigravity',
          modelsByAgentId: {
            antigravity: { models, selectedModelId: 'gemini-4-hydrogen', configId: 'model', updatedAt: '' },
          },
          configByAgentId: {},
        },
      },
      projectSessions: {
        '/repo': {
          ...createDefaultProjectState(),
          _activeSessionId: 'src-1',
          _sessions: { 'src-1': src },
        },
      },
    }))

    const nextId = handoffToNewSession('/repo', 'src-1')
    const next = useChatStore.getState().projectSessions['/repo']._sessions[nextId!]
    expect(next.selectedModel).toBe('gemini-4-hydrogen')
    expect(next.acpModels).toEqual(models)
  })

  it('preserves remote project key, environmentSelection, and remote model catalog on handoff', () => {
    const remoteKey = 'remote:node-1:/srv/app'
    const remoteModels = [{ id: 'grok-4', name: 'Grok 4', description: '' }]
    const src = {
      ...createDefaultPerSessionState(),
      _title: 'Remote Task',
      sessionProvider: 'acp-grok' as const,
      preferredProvider: 'acp-grok' as const,
      acpAgentId: 'grok-build',
      selectedModel: 'grok-4',
      acpModels: remoteModels,
      acpModelConfigId: 'model',
      acpModelsStatus: 'ready' as const,
      environmentSelection: {
        environmentId: 'node-1',
        selection: { kind: 'existing' as const, path: '/srv/app/.worktrees/fix', branch: 'fix' },
      },
      _worktreePath: '/srv/app/.worktrees/fix',
      _gitBranch: 'fix',
    }
    useChatStore.setState({
      activeProject: remoteKey,
      projectSessions: {
        [remoteKey]: {
          ...createDefaultProjectState(),
          _activeSessionId: 'remote-src',
          _sessions: { 'remote-src': src },
        },
      },
    })

    const nextId = handoffToNewSession(remoteKey, 'remote-src', 'm-1')
    const proj = useChatStore.getState().projectSessions[remoteKey]
    expect(proj._activeSessionId).toBe(nextId)
    const next = proj._sessions[nextId!]
    expect(next.cwd).toBe(remoteKey)
    expect(next._worktreePath).toBe('/srv/app/.worktrees/fix')
    expect(next._gitBranch).toBe('fix')
    expect(next.environmentSelection).toEqual(src.environmentSelection)
    expect(next.selectedModel).toBe('grok-4')
    expect(next.acpModels).toEqual(remoteModels)
    expect(next.mentions).toEqual([
      { kind: 'session', value: 'remote-src', displayName: 'Remote Task', upToMessageId: 'm-1' },
    ])
  })
})
