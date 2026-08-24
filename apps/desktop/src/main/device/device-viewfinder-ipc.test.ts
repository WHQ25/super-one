import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DESKTOP_ROOT = join(__dirname, '../../..')
const REPO_ROOT = join(DESKTOP_ROOT, '../..')

describe('device viewfinder claim IPC', () => {
  it('connects device tool execution through main and preload to the renderer', () => {
    const shared = readFileSync(join(REPO_ROOT, 'packages/shared/src/agent-types.ts'), 'utf8')
    const executor = readFileSync(join(DESKTOP_ROOT, 'src/main/device-agent/index.ts'), 'utf8')
    const main = readFileSync(join(DESKTOP_ROOT, 'src/main/index.ts'), 'utf8')
    const preload = readFileSync(join(DESKTOP_ROOT, 'src/preload/index.ts'), 'utf8')
    const preloadTypes = readFileSync(join(DESKTOP_ROOT, 'src/preload/index.d.ts'), 'utf8')
    const hook = readFileSync(join(DESKTOP_ROOT, 'src/renderer/src/hooks/useAgentViewfinder.ts'), 'utf8')

    expect(shared).toContain("ENVIRONMENT_DEVICE_VIEWFINDER_CLAIM: 'environment:deviceViewfinderClaim'")
    expect(executor).toContain('viewfinderClaimSink?.({ sessionId, deviceId })')
    expect(main).toContain("void import('./device-agent').then(({ setDeviceAgentViewfinderClaimSink })")
    expect(main).toContain('AgentIpcChannels.ENVIRONMENT_DEVICE_VIEWFINDER_CLAIM')
    expect(preload).toContain('onDeviceViewfinderClaim:')
    expect(preload).toContain('ipcRenderer.on(AgentIpcChannels.ENVIRONMENT_DEVICE_VIEWFINDER_CLAIM')
    expect(preloadTypes).toContain('onDeviceViewfinderClaim(')
    expect(hook).toContain('window.environment.onDeviceViewfinderClaim')
  })
})
