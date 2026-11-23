import { ipcRenderer } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type {
  DshClientPluginList,
  DshPluginRpcEventPayload,
  DshPluginRpcResult,
} from '@superone/shared/dsh-plugin-client'

const rpcEventListeners = new Map<string, Set<(payload: unknown) => void>>()
const pluginsChangedListeners = new Set<() => void>()

let rpcListenerAttached = false
let pluginsChangedListenerAttached = false

function eventMapKey(pluginId: string, event: string): string {
  return `${pluginId}\0${event}`
}

function ensureRpcListener(): void {
  if (rpcListenerAttached) return
  rpcListenerAttached = true
  ipcRenderer.on(
    AgentIpcChannels.DSH_PLUGIN_RPC_EVENT,
    (_event, message: DshPluginRpcEventPayload) => {
      if (!message || typeof message.pluginId !== 'string' || typeof message.event !== 'string') return
      const listeners = rpcEventListeners.get(eventMapKey(message.pluginId, message.event))
      if (!listeners) return
      for (const cb of [...listeners]) cb(message.payload)
    },
  )
}

function ensurePluginsChangedListener(): void {
  if (pluginsChangedListenerAttached) return
  pluginsChangedListenerAttached = true
  ipcRenderer.on(AgentIpcChannels.DSH_PLUGINS_CHANGED, () => {
    for (const cb of [...pluginsChangedListeners]) cb()
  })
}

export const superonePluginAPI = {
  listClientPlugins: () =>
    ipcRenderer.invoke(AgentIpcChannels.DSH_CLIENT_PLUGIN_LIST) as Promise<DshClientPluginList>,
  invoke: <T = unknown>(pluginId: string, method: string, payload?: unknown) =>
    ipcRenderer.invoke(
      AgentIpcChannels.DSH_PLUGIN_RPC_INVOKE,
      pluginId,
      method,
      payload,
    ) as Promise<DshPluginRpcResult<T>>,
  on: (pluginId: string, event: string, callback: (payload: unknown) => void) => {
    ensureRpcListener()
    const key = eventMapKey(pluginId, event)
    const set = rpcEventListeners.get(key) ?? new Set()
    rpcEventListeners.set(key, set)
    set.add(callback)
    return () => {
      set.delete(callback)
      if (set.size === 0) rpcEventListeners.delete(key)
    }
  },
  onPluginsChanged: (callback: () => void) => {
    ensurePluginsChangedListener()
    pluginsChangedListeners.add(callback)
    return () => {
      pluginsChangedListeners.delete(callback)
    }
  },
}
