import { describe, expect, it, vi } from 'vitest'
import { IosSimulatorBackend } from './ios-backend'
import type { IosSimulatorManager } from '../ios-simulator/ios-simulator-manager'

describe('IosSimulatorBackend', () => {
  it('cancels an in-flight gesture when the request is aborted', async () => {
    const controller = new AbortController()
    const inputs: Array<{ type: string; contacts?: Array<{ phase: string }> }> = []
    const manager = {
      input: vi.fn(async (_sessionId: string, input: { type: string; contacts?: Array<{ phase: string }> }) => {
        inputs.push(input)
        if (input.type === 'touch.update' && input.contacts?.[0]?.phase === 'began') {
          queueMicrotask(() => controller.abort())
        }
        return { ok: true }
      }),
    } as unknown as IosSimulatorManager
    const backend = new IosSimulatorBackend(manager, 'session-1')

    await expect(backend.perform({
      kind: 'longPress',
      x: 0.5,
      y: 0.5,
      durationMs: 1000,
    }, controller.signal)).rejects.toMatchObject({ code: 'ABORTED' })

    expect(inputs.map((input) => input.type)).toEqual(['touch.update', 'touch.cancel'])
  })
})
