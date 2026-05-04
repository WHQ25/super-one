import { describe, it, expect, beforeEach } from 'vitest'
import { useMiniAppMediaStore } from './miniapp-media'

describe('useMiniAppMediaStore', () => {
  beforeEach(() => {
    useMiniAppMediaStore.setState({ active: {} })
  })

  it('starts with no active apps', () => {
    expect(useMiniAppMediaStore.getState().active).toEqual({})
  })

  it('records mic start for an app', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    expect(useMiniAppMediaStore.getState().active).toEqual({ 'app-a': { microphone: 1 } })
  })

  it('records both kinds when started together', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone', 'camera'])
    expect(useMiniAppMediaStore.getState().active).toEqual({ 'app-a': { microphone: 1, camera: 1 } })
  })

  it('increments count when same kind started twice (concurrent streams)', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    expect(useMiniAppMediaStore.getState().active['app-a']).toEqual({ microphone: 2 })
  })

  it('decrements count on track end and only clears when reaching zero', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    useMiniAppMediaStore.getState().endTrack('app-a', 'microphone')
    expect(useMiniAppMediaStore.getState().active['app-a']).toEqual({ microphone: 1 })
    useMiniAppMediaStore.getState().endTrack('app-a', 'microphone')
    expect(useMiniAppMediaStore.getState().active['app-a']).toBeUndefined()
  })

  it('removes only the specific kind when multiple kinds are active', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone', 'camera'])
    useMiniAppMediaStore.getState().endTrack('app-a', 'microphone')
    expect(useMiniAppMediaStore.getState().active['app-a']).toEqual({ camera: 1 })
  })

  it('isolates apps from each other', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    useMiniAppMediaStore.getState().start('app-b', ['camera'])
    expect(useMiniAppMediaStore.getState().active).toEqual({
      'app-a': { microphone: 1 },
      'app-b': { camera: 1 },
    })
    useMiniAppMediaStore.getState().endTrack('app-a', 'microphone')
    expect(useMiniAppMediaStore.getState().active).toEqual({ 'app-b': { camera: 1 } })
  })

  it('clearApp removes all kinds for that app', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone', 'camera'])
    useMiniAppMediaStore.getState().start('app-b', ['camera'])
    useMiniAppMediaStore.getState().clearApp('app-a')
    expect(useMiniAppMediaStore.getState().active).toEqual({ 'app-b': { camera: 1 } })
  })

  it('endTrack on unknown kind is a no-op', () => {
    useMiniAppMediaStore.getState().start('app-a', ['microphone'])
    useMiniAppMediaStore.getState().endTrack('app-a', 'camera')
    expect(useMiniAppMediaStore.getState().active['app-a']).toEqual({ microphone: 1 })
  })

  it('endTrack on unknown app is a no-op', () => {
    useMiniAppMediaStore.getState().endTrack('ghost', 'microphone')
    expect(useMiniAppMediaStore.getState().active).toEqual({})
  })
})
