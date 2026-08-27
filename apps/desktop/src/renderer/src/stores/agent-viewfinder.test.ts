import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectViewfinderTarget,
  useAgentViewfinderStore,
  viewfinderKindForToolName,
} from './agent-viewfinder'

const target = (sessionId = 'session-a') => (
  selectViewfinderTarget(useAgentViewfinderStore.getState(), sessionId)
)

beforeEach(() => {
  useAgentViewfinderStore.setState({ activeBySession: {} })
})

describe('the shared agent viewfinder', () => {
  it('shows nothing until something asks for it', () => {
    expect(target()).toBeNull()
  })

  it('keeps the latest exact target for a session', () => {
    const store = useAgentViewfinderStore.getState()
    store.activate('session-a', 'browser', 'browser-a')
    store.activate('session-a', 'browser', 'browser-b')

    expect(target()).toEqual({ kind: 'browser', targetId: 'browser-b' })
  })

  it('keeps the resolved target while the next tool call is still unresolved', () => {
    const store = useAgentViewfinderStore.getState()
    store.activate('session-a', 'browser', 'browser-a')
    store.activate('session-a', 'browser')

    expect(target()).toEqual({ kind: 'browser', targetId: 'browser-a' })
  })

  it('drops the resolved target when an unresolved call switches surface', () => {
    const store = useAgentViewfinderStore.getState()
    store.activate('session-a', 'browser', 'browser-a')
    store.activate('session-a', 'device')

    expect(target()).toEqual({ kind: 'device', targetId: null })
  })

  it('shows nothing when the latest target exits instead of falling back', () => {
    const store = useAgentViewfinderStore.getState()
    store.activate('session-a', 'device', 'device-a')
    store.activate('session-a', 'computer', '42')
    store.clear('session-a', { kind: 'computer', targetId: '42' })

    expect(target()).toBeNull()
  })

  it('does not clear a newer target when an older target exits late', () => {
    const store = useAgentViewfinderStore.getState()
    store.activate('session-a', 'computer', '42')
    store.activate('session-a', 'browser', 'browser-a')
    store.clear('session-a', { kind: 'computer', targetId: '42' })

    expect(target()).toEqual({ kind: 'browser', targetId: 'browser-a' })
  })

  it('isolates recency between sessions', () => {
    const store = useAgentViewfinderStore.getState()
    store.activate('session-a', 'browser', 'browser-a')
    store.activate('session-b', 'device', 'device-b')

    expect(target('session-a')).toEqual({ kind: 'browser', targetId: 'browser-a' })
    expect(target('session-b')).toEqual({ kind: 'device', targetId: 'device-b' })
  })

  it('recognizes target-operating tools without treating catalog calls as activity', () => {
    expect(viewfinderKindForToolName('mcp__superone__browser_click')).toBe('browser')
    expect(viewfinderKindForToolName('mcp__superone__computer_act')).toBe('computer')
    expect(viewfinderKindForToolName('mcp__superone__device_snapshot')).toBe('device')
    expect(viewfinderKindForToolName('mcp__superone__computer_apps')).toBeNull()
    expect(viewfinderKindForToolName('mcp__superone__device_list')).toBeNull()
  })
})
