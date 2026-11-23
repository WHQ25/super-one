import { describe, expect, it, vi } from 'vitest'

const { ipcBus } = vi.hoisted(() => {
  const { EventEmitter } = require('node:events') as typeof import('node:events')
  return { ipcBus: new EventEmitter() }
})

vi.mock('electron', () => ({
  ipcRenderer: {
    on: (ch: string, cb: (...args: unknown[]) => void) => ipcBus.on(ch, cb),
    invoke: vi.fn(),
  },
}))

import { superonePluginAPI } from './superone-plugin-api'
import { AgentIpcChannels } from '@superone/shared/agent-types'

describe('superonePluginAPI multiplexed preload tunnel', () => {
  it('registers at most one ipcRenderer listener per channel across many subscriptions', () => {
    const receivedA: unknown[] = []
    const receivedB: unknown[] = []
    const unsubs: Array<() => void> = []

    for (let i = 0; i < 20; i++) {
      unsubs.push(superonePluginAPI.on('p1', 'tick', (p) => receivedA.push(p)))
      unsubs.push(superonePluginAPI.onPluginsChanged(() => receivedB.push('changed')))
    }

    expect(ipcBus.listenerCount(AgentIpcChannels.DSH_PLUGIN_RPC_EVENT)).toBe(1)
    expect(ipcBus.listenerCount(AgentIpcChannels.DSH_PLUGINS_CHANGED)).toBe(1)

    ipcBus.emit(AgentIpcChannels.DSH_PLUGIN_RPC_EVENT, {}, { pluginId: 'p1', event: 'tick', payload: 7 })
    ipcBus.emit(AgentIpcChannels.DSH_PLUGIN_RPC_EVENT, {}, { pluginId: 'p2', event: 'tick', payload: 8 })
    ipcBus.emit(AgentIpcChannels.DSH_PLUGINS_CHANGED, {})

    expect(receivedA).toHaveLength(20)
    expect(receivedA[0]).toBe(7)
    expect(receivedB).toHaveLength(20)

    for (const u of unsubs) u()
    receivedA.length = 0
    receivedB.length = 0

    ipcBus.emit(AgentIpcChannels.DSH_PLUGIN_RPC_EVENT, {}, { pluginId: 'p1', event: 'tick', payload: 9 })
    ipcBus.emit(AgentIpcChannels.DSH_PLUGINS_CHANGED, {})
    expect(receivedA).toEqual([])
    expect(receivedB).toEqual([])
  })
})
