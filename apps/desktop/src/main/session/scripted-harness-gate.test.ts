import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false } }))
vi.mock('electron', () => electron)

import { SCRIPTED_HARNESS_ENV, scriptedHarnessEnabled } from './scripted-harness-gate'
import { harnessRegistry } from './harness-registry'
import { ScriptedBackend } from './backends/scripted-backend'

describe('scripted harness gate', () => {
  afterEach(() => {
    delete process.env[SCRIPTED_HARNESS_ENV]
    electron.app.isPackaged = false
  })

  it('keeps real backends when the variable is unset', () => {
    expect(scriptedHarnessEnabled()).toBe(false)
    expect(harnessRegistry.get('claude-code')?.createBackend()).not.toBeInstanceOf(ScriptedBackend)
  })

  it('swaps every harness for scripted turns in an unpackaged build started with the variable', () => {
    process.env[SCRIPTED_HARNESS_ENV] = '1'
    expect(harnessRegistry.get('codex')?.createBackend()).toBeInstanceOf(ScriptedBackend)
  })

  it('ignores the variable in a packaged build', () => {
    process.env[SCRIPTED_HARNESS_ENV] = '1'
    electron.app.isPackaged = true
    expect(scriptedHarnessEnabled()).toBe(false)
    expect(harnessRegistry.get('claude-code')?.createBackend()).not.toBeInstanceOf(ScriptedBackend)
  })
})
