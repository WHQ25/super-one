import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DESKTOP_ROOT = join(__dirname, '../../..')
const REPO_ROOT = join(DESKTOP_ROOT, '../..')

describe('iOS Simulator rotation gesture IPC', () => {
  it('connects the macOS window event through preload to the renderer API', () => {
    const shared = readFileSync(join(REPO_ROOT, 'packages/shared/src/agent-types.ts'), 'utf8')
    const main = readFileSync(join(DESKTOP_ROOT, 'src/main/index.ts'), 'utf8')
    const gestureEvents = readFileSync(join(DESKTOP_ROOT, 'src/main/ios-simulator/gesture-events.ts'), 'utf8')
    const preload = readFileSync(join(DESKTOP_ROOT, 'src/preload/index.ts'), 'utf8')
    const preloadTypes = readFileSync(join(DESKTOP_ROOT, 'src/preload/index.d.ts'), 'utf8')

    expect(shared).toContain("ENVIRONMENT_IOS_SIMULATOR_ROTATE_GESTURE: 'environment:iosSimulatorRotateGesture'")
    expect(main).toContain('attachIosSimulatorGestureEvents(mainWindow)')
    expect(main).toContain('attachIosSimulatorGestureEvents(win)')
    expect(gestureEvents).toContain("win.on('rotate-gesture'")
    expect(gestureEvents).toContain('AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_ROTATE_GESTURE')
    expect(preload).toContain('onIosSimulatorRotateGesture:')
    expect(preload).toContain('ipcRenderer.on(AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_ROTATE_GESTURE')
    expect(preloadTypes).toContain('onIosSimulatorRotateGesture(callback: (rotation: number) => void): () => void')
  })
})
