import { useEffect, useState } from 'react'
import type { DeviceDescriptor } from '@superone/shared/device'

// A machine-level preference like preview quality: how the user likes to look at
// devices, not anything about one device or session.
const STORAGE_KEY = 'superone.device.view3d'

export function readDeviceView3d(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeDeviceView3d(value: boolean, storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): void {
  try {
    storage?.setItem(STORAGE_KEY, String(value))
  } catch {
    // A full or disabled storage costs the preference, not the view.
  }
}

// What is on disk does not change while the app runs, so one answer serves every panel.
let available: Promise<ReadonlySet<string>> | null = null

function availableModels(): Promise<ReadonlySet<string>> {
  available ??= (window.app?.listDeviceModels() ?? Promise.resolve([]))
    .then((models) => new Set(models))
    .catch(() => new Set<string>())
  return available
}

/**
 * Whether this device has a 3D body on this machine.
 *
 * Simulators only: their `model` is the simulator device type, which is what the
 * catalog is keyed by. A mirrored iPhone or an Android device has no such name.
 */
export function useDeviceModelAvailable(device: DeviceDescriptor | null): boolean {
  const model = device?.provider === 'ios-sim' ? device.model : null
  const [answer, setAnswer] = useState<{ model: string; available: boolean } | null>(null)
  useEffect(() => {
    if (!model) return
    let cancelled = false
    void availableModels().then((models) => {
      if (!cancelled) setAnswer({ model, available: models.has(model) })
    })
    return () => { cancelled = true }
  }, [model])
  return model !== null && answer?.model === model && answer.available
}
