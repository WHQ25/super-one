type AnyFn = (...args: unknown[]) => unknown

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
