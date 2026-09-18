import { expect, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import type { HarnessId, RemoteSystemInfo } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { useHarnessSelection } from './use-harness-selection'

const wrapper = ({ children }: { children: ReactNode }) =>
  <MobileThemeProvider>{children}</MobileThemeProvider>

test('retains a draft model, mode, provider and effort when the catalog refreshes', async () => {
  const { result } = await renderHook(() => useHarnessSelection(), { wrapper })
  await act(async () => { result.current.restoreDraft({ harness: 'claude', model: 'saved-model', effort: 'max', permissionMode: 'plan', apiProviderId: 'saved-provider', selectedAcpModeId: 'saved-mode' }) })
  await act(async () => { result.current.applySystemInfo('claude', { models: [{ id: 'default-model', name: 'Default', description: '' }], defaults: { model: 'default-model' } }) })
  expect(result.current.selectedModel).toBe('saved-model')
  expect(result.current.selectedEffort).toBe('max')
  expect(result.current.permissionMode).toBe('plan')
  expect(result.current.selectedProviderId).toBe('saved-provider')
  expect(result.current.selectedModeId).toBe('saved-mode')
})

const claudeInfo: RemoteSystemInfo = {
  models: [
    { id: 'opus-4-8', name: 'Opus 4.8', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
    { id: 'sonnet-4-6', name: 'Sonnet 4.6', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
  ],
  permissionModes: ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'],
  defaults: { model: 'opus-4-8', effort: 'high', permissionMode: 'auto', sandboxMode: 'on' },
}

async function mount() {
  return await renderHook(() => useHarnessSelection(), { wrapper })
}

/**
 * The desktop's own defaults are the whole point of the catalog: a phone has no
 * settings store, so anything it does not adopt here is silently lost.
 */
test('a harness catalog adopts the host defaults the user has not overridden', async () => {
  const { result } = await mount()

  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })

  expect(result.current.selectedModel).toBe('opus-4-8')
  expect(result.current.selectedEffort).toBe('high')
  expect(result.current.permissionMode).toBe('auto')
  expect(result.current.defaultSandboxMode).toBe('on')
})

/**
 * Regression: the shell re-applies the catalog on every shell-details refresh.
 * The second pass used to feed the hook's own state back in as if the user had
 * chosen it, so `effort: ''` reached `?? defaults.effort` — which `??` does not
 * treat as absent — and `permissionMode: 'default'` (a legal mode on every
 * harness) outranked the host's `auto` forever.
 */
test('re-applying the same catalog does not drift off the host defaults', async () => {
  const { result } = await mount()

  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })

  expect(result.current.selectedEffort).toBe('high')
  expect(result.current.permissionMode).toBe('auto')
})

test('a pick the user made outranks the host default on the next refresh', async () => {
  const { result } = await mount()
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })

  await act(async () => { result.current.setSelectedEffort('low') })
  await act(async () => { result.current.setPermissionMode('plan') })
  await act(async () => { result.current.selectModel('sonnet-4-6') })
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })

  expect(result.current.selectedEffort).toBe('low')
  expect(result.current.permissionMode).toBe('plan')
  expect(result.current.selectedModel).toBe('sonnet-4-6')
})

test('switching harness drops the previous picks and takes the new host defaults', async () => {
  const { result } = await mount()
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })
  await act(async () => { result.current.setSelectedEffort('low') })

  await act(async () => { result.current.resetForProvider('claude') })
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })

  expect(result.current.selectedEffort).toBe('high')
  expect(result.current.permissionMode).toBe('auto')
})

/**
 * Opening an existing session hands over that session's own stored settings.
 * They are authoritative — but a session that never set one sends `''`, which
 * must fall through to the host default rather than blanking the row.
 */
/**
 * A model pick is a visit-local override. Leaving the session (reset) must
 * drop it so the next open restores that session's stored model, not the pick
 * made while looking at a different one.
 */
test('switching session restores the opened session model, not the previous visit pick', async () => {
  const { result } = await mount()
  await act(async () => {
    result.current.applySystemInfo('claude', claudeInfo, { model: 'opus-4-8' })
  })
  await act(async () => { result.current.selectModel('sonnet-4-6') })

  await act(async () => { result.current.resetForProvider('claude') })
  await act(async () => {
    result.current.applySystemInfo('claude', claudeInfo, { model: 'opus-4-8' })
  })

  expect(result.current.selectedModel).toBe('opus-4-8')
})

test('an opened session overrides the defaults, and its unset fields fall through', async () => {
  const { result } = await mount()

  await act(async () => {
    result.current.applySystemInfo('claude', claudeInfo, {
      model: 'sonnet-4-6',
      effort: '',
      permissionMode: 'plan',
    })
  })

  expect(result.current.selectedModel).toBe('sonnet-4-6')
  expect(result.current.permissionMode).toBe('plan')
  expect(result.current.selectedEffort).toBe('high')
})

const codexInfo: RemoteSystemInfo = {
  models: [{
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    description: '',
    supportedReasoningEfforts: [
      { value: 'medium', description: '' },
      { value: 'high', description: '' },
    ],
    serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }],
  }],
  permissionModes: ['default', 'auto', 'bypassPermissions'],
  defaults: { model: 'gpt-6-astra', effort: 'high', permissionMode: 'auto', fastMode: true },
}

test.each([{ models: [] }, { models: codexInfo.models }])('keeps an opened Codex model and effort when the catalog omits it ($models)', async ({ models }) => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => {
    result.current.applySystemInfo('codex', { ...codexInfo, models }, { model: 'gpt-5.6-sol', effort: 'xhigh' })
  })
  await act(async () => { result.current.applySystemInfo('codex', { ...codexInfo, models }) })
  expect(result.current.selectedModel).toBe('gpt-5.6-sol')
  expect(result.current.selectedEffort).toBe('xhigh')
})

/** Codex's Fast row is a service tier, so the host default has to name one. */
test('the host Codex Fast default arms the model service tier', async () => {
  const { result } = await mount()

  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })

  expect(result.current.serviceTier).toBe('priority')
  expect(result.current.optionParams.find((param) => param.id === 'fast')?.selected).toBe('true')
})

test('a Codex model switch clears the Fast tier the previous model declared', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })

  await act(async () => { result.current.selectModel('gpt-6-astra') })

  expect(result.current.serviceTier).toBeNull()
})

test('opening a Codex session restores Fast from the session, not the host default', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => {
    result.current.applySystemInfo('codex', codexInfo, {
      model: 'gpt-6-astra',
      effort: 'high',
      permissionMode: 'auto',
      serviceTier: null,
    })
  })

  expect(result.current.serviceTier).toBeNull()
  expect(result.current.optionParams.find((param) => param.id === 'fast')?.selected).toBe('false')
})

test('a restored Codex Fast-off survives catalog refresh when the host default is on', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => {
    result.current.applySystemInfo('codex', codexInfo, {
      model: 'gpt-6-astra',
      serviceTier: null,
    })
  })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })

  expect(result.current.serviceTier).toBeNull()
})

test('a restored Codex Fast-on survives catalog refresh', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => {
    result.current.applySystemInfo('codex', { ...codexInfo, defaults: { ...codexInfo.defaults, fastMode: false } }, {
      model: 'gpt-6-astra',
      serviceTier: 'priority',
    })
  })
  await act(async () => {
    result.current.applySystemInfo('codex', { ...codexInfo, defaults: { ...codexInfo.defaults, fastMode: false } })
  })

  expect(result.current.serviceTier).toBe('priority')
  expect(result.current.optionParams.find((param) => param.id === 'fast')?.selected).toBe('true')
})

test('switching session restores that session Fast, not the previous visit pick', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => {
    result.current.applySystemInfo('codex', codexInfo, { model: 'gpt-6-astra', serviceTier: 'priority' })
  })
  await act(async () => { result.current.setOptionParam('fast', 'false') })

  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => {
    result.current.applySystemInfo('codex', codexInfo, { model: 'gpt-6-astra', serviceTier: 'priority' })
  })

  expect(result.current.serviceTier).toBe('priority')
})

test('a Fast pick on the landing survives catalog refresh', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })
  await act(async () => { result.current.setOptionParam('fast', 'false') })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })

  expect(result.current.serviceTier).toBeNull()
})

test('a model switch does not let catalog refresh re-arm host default Fast', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('codex') })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })
  await act(async () => { result.current.selectModel('gpt-6-astra') })
  await act(async () => { result.current.applySystemInfo('codex', codexInfo) })

  expect(result.current.serviceTier).toBeNull()
})

const claudeWithProvider: RemoteSystemInfo = {
  ...claudeInfo,
  providers: [
    { id: 'cred-host', name: 'Host' },
    { id: 'cred-session', name: 'Session' },
  ],
  selectedProviderId: 'cred-host',
}

test('opening a session restores its API provider over the catalog default', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('claude') })
  await act(async () => {
    result.current.applySystemInfo('claude', claudeWithProvider, {
      model: 'opus-4-8',
      apiProviderId: 'cred-session',
    })
  })
  await act(async () => { result.current.applySystemInfo('claude', claudeWithProvider) })

  expect(result.current.selectedProviderId).toBe('cred-session')
})

const acpInfo: RemoteSystemInfo = {
  models: [{ id: 'grok-4', name: 'Grok 4', description: '' }],
  modes: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }],
  selectedModeId: 'ask',
  permissionModes: ['default', 'plan'],
  defaults: { model: 'grok-4', permissionMode: 'default' },
}

test('opening an ACP session restores its mode over the catalog default', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('acp') })
  await act(async () => {
    result.current.applySystemInfo('acp', acpInfo, { model: 'grok-4', selectedModeId: 'code' })
  })
  await act(async () => { result.current.applySystemInfo('acp', acpInfo) })

  expect(result.current.selectedModeId).toBe('code')
})

const openCodeInfo: RemoteSystemInfo = {
  models: [{ id: 'oc-model', name: 'OC', description: '' }],
  agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }],
  selectedAgentId: 'build',
  permissionModes: ['default'],
  defaults: { model: 'oc-model', permissionMode: 'default' },
}

test('opening an OpenCode session restores its agent over the catalog default', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('opencode') })
  await act(async () => {
    result.current.applySystemInfo('opencode', openCodeInfo, { model: 'oc-model', selectedAgentId: 'plan' })
  })
  await act(async () => { result.current.applySystemInfo('opencode', openCodeInfo) })

  expect(result.current.selectedAgentId).toBe('plan')
})

test('switching session drops a visit-local OpenCode agent pick', async () => {
  const { result } = await mount()
  await act(async () => { result.current.resetForProvider('opencode') })
  await act(async () => {
    result.current.applySystemInfo('opencode', openCodeInfo, { model: 'oc-model', selectedAgentId: 'build' })
  })
  await act(async () => { result.current.selectAgent('plan') })

  await act(async () => { result.current.resetForProvider('opencode') })
  await act(async () => {
    result.current.applySystemInfo('opencode', openCodeInfo, { model: 'oc-model', selectedAgentId: 'build' })
  })

  expect(result.current.selectedAgentId).toBe('build')
})

/**
 * The sandbox toggle is a host platform fact, not a harness one — Windows has no
 * sandbox at all, and a chip that still opens a menu there is lying.
 */
test('the host sandbox support level travels with the catalog', async () => {
  const { result } = await mount()

  await act(async () => {
    result.current.applySystemInfo('claude', { ...claudeInfo, sandboxSupport: 'unsupported' })
  })

  expect(result.current.sandboxSupport).toBe('unsupported')
})

test('a host that predates sandbox reporting is treated as supported', async () => {
  const { result } = await mount()

  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })

  expect(result.current.sandboxSupport).toBe('always')
})

test.each<HarnessId>(['opencode', 'cursor', 'dsh'])(
  '%s falls back to the first permission mode when the host names none',
  async (harness) => {
    const { result } = await mount()

    await act(async () => {
      result.current.applySystemInfo(harness, {
        models: [{ id: 'model-a', name: 'A', description: '' }],
        permissionModes: ['plan', 'default'],
        defaults: { model: 'model-a', effort: null, permissionMode: null },
      })
    })

    expect(result.current.permissionMode).toBe('plan')
  },
)

test('catalogReady is false from a harness reset until its catalog lands', async () => {
  const { result } = await mount()
  expect(result.current.catalogReady).toBe(false)
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })
  expect(result.current.catalogReady).toBe(true)

  await act(async () => { result.current.resetForProvider('claude') })
  expect(result.current.catalogReady).toBe(false)
  await act(async () => { result.current.applySystemInfo('claude', claudeInfo) })
  expect(result.current.catalogReady).toBe(true)
})
