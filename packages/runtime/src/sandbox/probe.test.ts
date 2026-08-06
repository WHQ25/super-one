import { afterEach, describe, expect, it } from 'vitest'
import {
  getSandboxCapability,
  probeSandboxDependencies,
  probeSandboxRpc,
  resetSandboxCapabilityCacheForTests,
  sandboxModeToSdkSandbox,
} from './probe'

afterEach(() => {
  resetSandboxCapabilityCacheForTests()
})

describe('sandbox probe', () => {
  it('returns capability with supportLevel and defaultMode', () => {
    const cap = getSandboxCapability()
    expect(['always', 'conditional', 'unsupported']).toContain(cap.supportLevel)
    expect(['off', 'on', 'auto']).toContain(cap.defaultMode)
    expect(typeof cap.platform).toBe('string')
  })

  it('probeSandboxDependencies returns ok or missing deps', async () => {
    const result = await probeSandboxDependencies()
    if (result.ok) {
      expect(result).toEqual({ ok: true })
    } else {
      expect(Array.isArray(result.missing)).toBe(true)
      expect(typeof result.installHint).toBe('string')
    }
  })

  it('probeSandboxRpc returns capability booleans', async () => {
    const result = await probeSandboxRpc()
    expect(typeof result.ok).toBe('boolean')
    expect(typeof result.bwrap).toBe('boolean')
    expect(typeof result.socat).toBe('boolean')
    expect(typeof result.supportLevel).toBe('string')
    expect(result.probe).toBeDefined()
    expect(result.capability).toBeDefined()
  })

  it('sandboxModeToSdkSandbox maps on/auto', () => {
    if (getSandboxCapability().supportLevel === 'unsupported') {
      expect(sandboxModeToSdkSandbox('on')).toBeUndefined()
      return
    }
    expect(sandboxModeToSdkSandbox('off')).toBeUndefined()
    expect(sandboxModeToSdkSandbox('on')).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: false,
      failIfUnavailable: false,
    })
    expect(sandboxModeToSdkSandbox('auto')).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      failIfUnavailable: false,
    })
  })
})
