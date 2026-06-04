import { useEffect } from 'react'

let scanModule: typeof import('react-scan') | null = null

export function useReactScan(enabled: boolean): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let cancelled = false
    if (enabled) {
      const load = scanModule
        ? Promise.resolve(scanModule)
        : import('react-scan').then((m) => (scanModule = m))
      void load.then((m) => {
        if (cancelled) return
        m.scan({ enabled: true, showToolbar: true, trackUnnecessaryRenders: true, log: false })
      })
    } else if (scanModule) {
      scanModule.scan({ enabled: false, showToolbar: false })
    }
    return () => { cancelled = true }
  }, [enabled])
}
