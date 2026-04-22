import { describe, it, expect, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../agent/claude-permissions', () => ({
  createCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  respondToPermission: vi.fn(),
  respondToQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  respondToPlanApproval: vi.fn(),
  rejectAllPending: vi.fn(),
}))

vi.mock('../agent/claude-query', () => ({
  createSessionQuery: vi.fn(),
  buildUserMessage: vi.fn(),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
}))

vi.mock('../codex/codex-turn', () => ({
  runCodexTurn: vi.fn(),
  reviewCodexTurn: vi.fn(),
  compactCodexTurn: vi.fn(),
  steerCodex: vi.fn(async () => {}),
  interruptCodex: vi.fn(() => false),
  resetCodexSession: vi.fn(),
  respondToCodexPermission: vi.fn(() => true),
  respondToCodexQuestion: vi.fn(() => true),
  dismissCodexQuestion: vi.fn(() => true),
  prewarmCodexConnection: vi.fn(async () => null),
}))

import { harnessRegistry } from './harness-registry'
import { setCodexServiceFactory } from './backends/codex-backend'

setCodexServiceFactory(() => ({
  getProjectAuth: vi.fn(() => ({ mode: 'auto' })),
  onAuthChanged: vi.fn(() => () => {}),
}))

describe('harnessRegistry', () => {
  it('lists claude and codex harnesses', () => {
    const ids = harnessRegistry.list().map((h) => h.id).sort()
    expect(ids).toEqual(['claude', 'codex'])
  })

  it('get returns the claude harness', () => {
    const h = harnessRegistry.get('claude')
    expect(h).toBeDefined()
    expect(h?.id).toBe('claude')
    expect(h?.name).toBeTruthy()
  })

  it('get returns the codex harness', () => {
    const h = harnessRegistry.get('codex')
    expect(h).toBeDefined()
    expect(h?.id).toBe('codex')
  })

  it('get returns undefined for unknown id', () => {
    // @ts-expect-error intentional invalid id
    expect(harnessRegistry.get('unknown')).toBeUndefined()
  })

  it('createBackend returns a live backend instance', () => {
    const h = harnessRegistry.get('claude')!
    const backend = h.createBackend()
    expect(backend.kind).toBe('claude')
  })

  it('codex createBackend returns a codex backend', () => {
    const h = harnessRegistry.get('codex')!
    expect(h.createBackend().kind).toBe('codex')
  })

  it('configSchema is defined (Zod schema)', () => {
    const h = harnessRegistry.get('claude')!
    expect(h.configSchema).toBeDefined()
  })

  it('codex configSchema accepts xhigh reasoning effort', () => {
    const h = harnessRegistry.get('codex')!
    expect(() => h.configSchema.parse({ reasoningEffort: 'xhigh' })).not.toThrow()
  })
})
