import { beforeEach, describe, expect, it } from 'vitest'
import {
  getActiveRuntimeCount,
  registerActiveRuntime,
  resetActiveRuntimeRegistryForTests,
  unregisterActiveRuntime,
} from './active-runtime-registry'

describe('active runtime registry', () => {
  beforeEach(() => {
    resetActiveRuntimeRegistryForTests()
  })

  it('counts active runtimes across backend types', () => {
    const claude = {}
    const codex = {}
    registerActiveRuntime(claude, () => true)
    registerActiveRuntime(codex, () => true)

    expect(getActiveRuntimeCount()).toBe(2)
  })

  it('ignores inactive and unregistered runtimes', () => {
    const active = {}
    const inactive = {}
    registerActiveRuntime(active, () => true)
    registerActiveRuntime(inactive, () => false)
    unregisterActiveRuntime(active)

    expect(getActiveRuntimeCount()).toBe(0)
  })
})
