import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import type { TouchDeviceBackend } from './types'
import {
  executeDeviceAgentTool,
  setDeviceAgentBackendFactory,
  setDeviceAgentViewfinderClaimSink,
} from './index'

const root: DeviceUiNode = {
  ref: '@e0',
  role: 'screen',
  bounds: [0, 0, 1, 1],
  children: [{ ref: '@e1', role: 'button', label: 'Continue', bounds: [0.1, 0.2, 0.3, 0.1] }],
}

function parse(reply: { content: Array<{ type: 'text'; text: string }> }): Record<string, unknown> {
  return JSON.parse(reply.content[0]!.text)
}

describe('device agent viewfinder claim', () => {
  const perform = vi.fn(async () => {})
  const backend: TouchDeviceBackend = {
    label: 'Injected Phone',
    observe: vi.fn(async () => ({
      root,
      orientation: 'portrait' as const,
      screen: { width: 1080, height: 2400 },
      settled: true,
    })),
    capture: vi.fn(async () => ({ path: '/tmp/device.png', width: 1080, height: 2400 })),
    perform,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setDeviceAgentBackendFactory(() => backend)
    setDeviceAgentViewfinderClaimSink(null)
  })

  it('claims the resolved device again when device_act starts', async () => {
    const snapshot = parse(await executeDeviceAgentTool('session-a', 'device_snapshot', {
      mode: 'semantic',
    }))
    const claim = vi.fn()
    setDeviceAgentViewfinderClaimSink(claim)

    const acted = await executeDeviceAgentTool('session-a', 'device_act', {
      stateId: snapshot.stateId,
      actions: [{ type: 'tap', ref: '@e1' }],
    })

    expect(acted.isError).toBeUndefined()
    expect(perform).toHaveBeenCalledTimes(1)
    expect(claim).toHaveBeenCalledWith({
      sessionId: 'session-a',
      deviceId: 'injected:device',
    })
  })
})
