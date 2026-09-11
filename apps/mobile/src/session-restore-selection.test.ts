import { expect, test } from 'vitest'
import { openedSessionSelection } from './session-restore-selection'

test('Codex restore includes Fast-off as an explicit null', () => {
  expect(openedSessionSelection('codex', {
    selectedCodexModel: 'gpt-6-astra',
    selectedCodexReasoningEffort: 'high',
    selectedCodexServiceTier: null,
    permissionMode: 'auto',
  })).toEqual({
    model: 'gpt-6-astra',
    effort: 'high',
    permissionMode: 'auto',
    serviceTier: null,
  })
})

test('Codex restore keeps the running Fast tier', () => {
  expect(openedSessionSelection('codex', {
    selectedCodexModel: 'gpt-6-astra',
    selectedCodexServiceTier: 'priority',
  })).toMatchObject({ model: 'gpt-6-astra', serviceTier: 'priority' })
})

test('non-Codex restore omits Fast so the host default is not treated as a session fact', () => {
  expect(openedSessionSelection('claude', {
    selectedModel: 'opus-4-8',
    selectedEffort: 'high',
    selectedCodexServiceTier: 'priority',
    permissionMode: 'plan',
  })).toEqual({
    model: 'opus-4-8',
    effort: 'high',
    permissionMode: 'plan',
  })
})

test('provider, ACP mode and OpenCode agent ride only when the session set them', () => {
  expect(openedSessionSelection('acp', {
    selectedModel: 'grok-4',
    apiProviderId: 'cred-1',
    selectedAcpModeId: 'code',
    openCodeAgentId: 'build',
  })).toEqual({
    model: 'grok-4',
    effort: '',
    permissionMode: '',
    apiProviderId: 'cred-1',
    selectedModeId: 'code',
    selectedAgentId: 'build',
  })

  expect(openedSessionSelection('opencode', {
    selectedModel: 'oc-model',
    apiProviderId: null,
    selectedAcpModeId: null,
    openCodeAgentId: null,
  })).toEqual({
    model: 'oc-model',
    effort: '',
    permissionMode: '',
  })
})
