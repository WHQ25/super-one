import type { BackendStartOptions } from '../../main/session/types'
import type { AcpRuntime } from '../../main/acp/acp-runtime'

/** Backend start options for an ACP session rooted at a throwaway project path. */
export function acpStartOpts(config: unknown = {}): BackendStartOptions {
  return {
    sessionId: 'sess-1',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config,
    permissionMode: 'default',
    abortController: new AbortController(),
  }
}

/**
 * ACP runtime stub with a two-option model/mode config. `prompt` streams one
 * text delta and completes; override it to control turn timing.
 */
export function mockAcpRuntime(overrides?: Partial<AcpRuntime>): AcpRuntime {
  return {
    sessionId: 'acp-sess-1',
    launch: {
      agentId: 'custom',
      command: 'echo',
      args: [],
      env: {},
      cwd: '/tmp/proj',
    },
    getConfigOptions: () => [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [
          { value: 'm1', name: 'Model 1' },
          { value: 'm2', name: 'Model 2' },
        ],
      },
    ],
    getModelConfig: () => ({
      configId: 'model',
      selectedModelId: 'm1',
      models: [
        { id: 'm1', name: 'Model 1', description: '' },
        { id: 'm2', name: 'Model 2', description: '' },
      ],
    }),
    setConfigOption: async (_configId, value) => [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: value,
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [
          { value: 'm1', name: 'Model 1' },
          { value: 'm2', name: 'Model 2' },
        ],
      },
    ],
    getModeConfig: () => ({
      configId: 'mode',
      selectedModeId: 'ask',
      modes: [
        { id: 'ask', name: 'Ask', description: '' },
        { id: 'code', name: 'Code', description: '' },
      ],
    }),
    setModel: async () => {},
    setAcpSessionMode: async () => {},
    getContextUsage: async () => null,
    isSessionRecapAvailable: () => true,
    requestRecap: async () => {},
    prompt: async (_text, messageId, onEvent) => {
      onEvent({
        type: 'content_delta',
        messageId,
        delta: { type: 'text', text: 'hello-from-mock' },
      })
      onEvent({ type: 'message_complete', messageId })
      onEvent({ type: 'status_change', status: 'idle' })
    },
    setPermissionMode: async () => {},
    cancel: async () => {},
    close: async () => {},
    ...overrides,
  }
}
