import { describe, expect, it } from 'vitest'
import type { ModelOption } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import type { ChatStore } from '@/stores/chat-store/types'
import { HARNESS_STRATEGIES, seedNewSession } from './strategies'

const model = (id: string, extra: Partial<ModelOption> = {}): ModelOption => ({ id, name: id, description: '', ...extra })
const CODEX_MODELS = [model('gpt-default', { isDefault: true, supportedReasoningEfforts: [{ value: 'medium', description: '' }], defaultReasoningEffort: 'medium' })]
const CLAUDE_MODELS = [model('opus', { isDefault: true })]

function context(resources: Partial<ChatStore['harnessResources']> = {}) {
  const project = { ...createDefaultProjectState(), codexModels: CODEX_MODELS }
  const state = { harnessResources: { claude: null, codex: null, acp: null, ...resources } } as unknown as ChatStore
  return { state, project, claudeModels: CLAUDE_MODELS }
}

describe('selection access', () => {
  it('keeps Codex picks in their own fields and the rest in the neutral ones', () => {
    const codex = HARNESS_STRATEGIES.codex.selection.patch({ model: 'gpt-x', effort: 'high' }, { modelUserChosen: true })
    expect(codex).toEqual({ selectedCodexModel: 'gpt-x', selectedCodexReasoningEffort: 'high', codexModelUserChosen: true })
    const cursor = HARNESS_STRATEGIES.cursor.selection.patch({ model: 'auto', effort: null }, { effortUserChosen: false })
    expect(cursor).toEqual({ selectedModel: 'auto', selectedEffort: undefined, effortUserChosen: false })
  })

  it('reads back what it wrote, flags included', () => {
    for (const harness of ['claude', 'codex'] as const) {
      const { selection } = HARNESS_STRATEGIES[harness]
      const session = { ...createDefaultPerSessionState(), ...selection.patch({ model: 'm', effort: 'low' }, { modelUserChosen: true, effortUserChosen: false }) }
      expect(selection.read(session)).toEqual({ model: 'm', effort: 'low', modelUserChosen: true, effortUserChosen: false })
    }
  })

  it('writes no flag it was not given', () => {
    expect(HARNESS_STRATEGIES.claude.selection.patch({ model: 'opus' })).toEqual({ selectedModel: 'opus' })
  })
})

describe('seedNewSession', () => {
  it('seeds Claude from its catalog and every session with the Codex catalog default', () => {
    const session = createDefaultPerSessionState()
    seedNewSession(session, 'claude', context())
    expect(session).toMatchObject({ selectedModel: 'opus', selectedCodexModel: 'gpt-default', selectedCodexReasoningEffort: 'medium' })
  })

  it('seeds OpenCode and Cursor from their own catalogs, never Claude’s', () => {
    const opencode = createDefaultPerSessionState()
    seedNewSession(opencode, 'opencode', context({ opencode: { models: [model('openai/gpt', { isDefault: true })], agents: [], commands: [] } }))
    expect(opencode.selectedModel).toBe('openai/gpt')

    const cursor = createDefaultPerSessionState()
    seedNewSession(cursor, 'cursor', context({ cursor: { models: [model('auto', { isDefault: true })], disabledModelIds: [] } as never }))
    expect(cursor.selectedModel).toBe('auto')
  })

  it('leaves dsh to its own model control', () => {
    const session = createDefaultPerSessionState()
    seedNewSession(session, 'dsh', context())
    expect(session.selectedModel).toBe('')
  })

  it('carries the replaced ACP session’s agent when the catalog is not cached', () => {
    const session = createDefaultPerSessionState()
    seedNewSession(session, 'acp', { ...context(), previousSession: { ...createDefaultPerSessionState(), acpAgentId: 'other-agent' } })
    expect(session).toMatchObject({ acpAgentId: 'other-agent', acpModelsStatus: 'loading', selectedModel: '' })
  })
})

describe('missingDefaults and restore', () => {
  it('fills a Claude session without a model, and leaves a chosen one alone', () => {
    const { project } = context()
    expect(HARNESS_STRATEGIES.claude.missingDefaults(createDefaultPerSessionState(), project, CLAUDE_MODELS)).toMatchObject({ selectedModel: 'opus' })
    expect(HARNESS_STRATEGIES.claude.missingDefaults({ ...createDefaultPerSessionState(), selectedModel: 'sonnet' }, project, CLAUDE_MODELS)).toEqual({})
  })

  it('keeps a restored OpenCode pick while the catalog has not been probed', () => {
    const session = { ...createDefaultPerSessionState(), selectedModel: 'kept/model' }
    expect(HARNESS_STRATEGIES.opencode.restore!(session, context())).toEqual({})
    const loadedEmpty = context({ opencode: { models: [], agents: [], commands: [] } })
    expect(HARNESS_STRATEGIES.opencode.restore!(session, loadedEmpty)).toMatchObject({ selectedModel: '' })
  })
})

describe('Codex live restore', () => {
  const snapshot = { selectedModel: 'gpt-running', selectedEffort: 'high' }

  it('maps the running model onto Codex fields', () => {
    const previous = createDefaultPerSessionState()
    const { fromUi } = HARNESS_STRATEGIES.codex.liveRestore!({ previous, stored: previous, atRequest: previous, fromUi: {}, snapshot })
    expect(fromUi).toMatchObject({ selectedCodexModel: 'gpt-running', selectedCodexReasoningEffort: 'high', codexModelUserChosen: true })
  })

  it('keeps a pick made since the request ahead of the snapshot', () => {
    const atRequest = createDefaultPerSessionState()
    const stored = { ...atRequest, selectedCodexModel: 'gpt-picked', codexModelUserChosen: true }
    const { fromUi, newer } = HARNESS_STRATEGIES.codex.liveRestore!({ previous: stored, stored, atRequest, fromUi: {}, snapshot })
    expect(fromUi.selectedCodexModel).toBe('gpt-picked')
    expect(newer).toMatchObject({ selectedCodexModel: 'gpt-picked' })
  })

  it('claims no newer pick for a session the store has not seen', () => {
    const previous = createDefaultPerSessionState()
    expect(HARNESS_STRATEGIES.codex.liveRestore!({ previous, fromUi: {}, snapshot }).newer).toBeUndefined()
  })
})
