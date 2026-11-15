import { describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  createCursorRuntime: vi.fn(),
}))

vi.mock('./cursor-runtime', () => runtime)

import { runCursorSdkTurn } from './run-sdk-turn'

describe('runCursorSdkTurn', () => {
  it('rejects /compact before a runtime exists', async () => {
    await expect(runCursorSdkTurn({
      apiKey: 'k',
      cwd: '/work',
      userDataRoot: '/data',
      prompt: '  /compact  ',
      onInputAccepted: () => { throw new Error('accepted') },
    })).rejects.toThrow(/one-shot sessions cannot compact/)
    expect(runtime.createCursorRuntime).not.toHaveBeenCalled()
  })
})
