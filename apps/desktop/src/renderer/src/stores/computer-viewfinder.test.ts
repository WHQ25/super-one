import { beforeEach, describe, expect, it } from 'vitest'
import { useComputerViewfinderStore } from './computer-viewfinder'

const target = {
  sessionId: 'session-a',
  active: true,
  windowId: 42,
  app: 'Notes',
  title: 'Draft',
  sourceWidth: 1200,
  sourceHeight: 800,
}

beforeEach(() => {
  useComputerViewfinderStore.getState().reset()
})

describe('computer use viewfinder stream', () => {
  it('accepts frames only for the active session target', () => {
    useComputerViewfinderStore.getState().applyClaim(target)
    useComputerViewfinderStore.getState().applyFrame({
      sessionId: 'session-b', windowId: 42, width: 480, height: 320, data: 'wrong',
    })
    expect(useComputerViewfinderStore.getState().frames['session-a']).toBeUndefined()

    useComputerViewfinderStore.getState().applyFrame({
      sessionId: 'session-a', windowId: 42, width: 480, height: 320, data: 'right',
    })
    expect(useComputerViewfinderStore.getState().frames['session-a']?.data).toBe('right')
  })

  it('keeps a dismissed target hidden until the target changes', () => {
    useComputerViewfinderStore.getState().applyClaim(target)
    useComputerViewfinderStore.getState().hide('session-a')
    expect(useComputerViewfinderStore.getState().hiddenSessions['session-a']).toBe(true)

    useComputerViewfinderStore.getState().applyClaim({ ...target, cursorX: 20, cursorY: 30 })
    expect(useComputerViewfinderStore.getState().hiddenSessions['session-a']).toBe(true)

    useComputerViewfinderStore.getState().applyClaim({ ...target, windowId: 43 })
    expect(useComputerViewfinderStore.getState().hiddenSessions['session-a']).toBe(false)
  })

  it('ignores a release from a different session', () => {
    useComputerViewfinderStore.getState().applyClaim(target)
    useComputerViewfinderStore.getState().applyClaim({ sessionId: 'session-b', active: false })
    expect(useComputerViewfinderStore.getState().targets['session-a']?.sessionId).toBe('session-a')

    useComputerViewfinderStore.getState().applyClaim({ sessionId: 'session-a', active: false })
    expect(useComputerViewfinderStore.getState().targets['session-a']).toBeUndefined()
  })

  it('keeps independent targets and last frames for concurrent sessions', () => {
    useComputerViewfinderStore.getState().applyClaim(target)
    useComputerViewfinderStore.getState().applyFrame({
      sessionId: 'session-a', windowId: 42, width: 480, height: 320, data: 'a',
    })
    useComputerViewfinderStore.getState().applyClaim({
      ...target, sessionId: 'session-b', windowId: 84,
    })

    expect(useComputerViewfinderStore.getState().targets['session-a']?.windowId).toBe(42)
    expect(useComputerViewfinderStore.getState().targets['session-b']?.windowId).toBe(84)
    expect(useComputerViewfinderStore.getState().frames['session-a']?.data).toBe('a')
  })
})
