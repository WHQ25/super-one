type AnyFn = (...args: unknown[]) => unknown

const overrides: Record<string, Record<string, AnyFn>> = {}

/** Register a per-story mock for `window.<ns>.<key>()`. Call from a story decorator. */
export function mockIpc(ns: string, key: string, fn: AnyFn): void {
  ;(overrides[ns] ??= {})[key] = fn
}

const warn = (ns: string, key: string) => {
  return (...args: unknown[]) => {
    console.warn(`[storybook] window.${ns}.${key}() called without mock`, args)
    return Promise.resolve(undefined)
  }
}

const offNoop = () => {}

const proxyFor = (ns: string): Record<string, AnyFn> => {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return undefined
        if (overrides[ns]?.[prop]) return overrides[ns][prop]
        if (prop.startsWith('on')) {
          return (..._args: unknown[]) => offNoop
        }
        return warn(ns, prop)
      },
    }
  ) as Record<string, AnyFn>
}

export function installIpcMocks(): void {
  const w = window as unknown as Record<string, unknown>
  if (!w.agent) w.agent = proxyFor('agent')
  if (!w.app) w.app = proxyFor('app')
  if (!w.miniapp) w.miniapp = proxyFor('miniapp')
  if (!w.electron) {
    w.electron = {
      ipcRenderer: {
        send: warn('electron.ipcRenderer', 'send'),
        invoke: warn('electron.ipcRenderer', 'invoke'),
        on: () => offNoop,
        once: () => offNoop,
        removeListener: offNoop,
        removeAllListeners: offNoop,
      },
      process: { platform: 'darwin', versions: {} },
    }
  }
}

// Renderer modules subscribe to IPC at *module init* (e.g. chat-store's prefs cache calls
// `window.app.onAppSettingsChange` top-level). Preview's own `installIpcMocks()` call runs
// after its imports have already been evaluated, so the mocks must land as an import-time
// side effect of this module — it is imported before any renderer store.
installIpcMocks()
