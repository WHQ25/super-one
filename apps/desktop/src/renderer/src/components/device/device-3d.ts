import { useEffect, useState } from 'react'
import { ANDROID_PHONE_REFERENCE_MODEL, type DeviceDescriptor } from '@superone/shared/device'

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

/** The exact body for iOS, or the local reference body for an ordinary Android AVD. */
export function deviceModelKey(device: DeviceDescriptor | null): string | null {
  if (device?.provider === 'ios-sim') return device.model
  if (device?.provider === 'android' && device.id.startsWith('android:avd:') && device.kind === 'phone') {
    return ANDROID_PHONE_REFERENCE_MODEL
  }
  return null
}

/** Whether this device has a 3D body on this machine. */
export function useDeviceModelAvailable(device: DeviceDescriptor | null): boolean {
  const model = deviceModelKey(device)
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
