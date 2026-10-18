import type { ConsumerId } from '@superone/shared/platform-registry'

/** Effects shared with settings UI, injected by the desktop host. */
export interface ConfigResourceServices {
  providerBindingChanged(consumer: ConsumerId): void
  projectPreferencesChanged(): void
  /** Present only in development builds. null restores the built-in icon. */
  setAppIcon?: (filePath: string | null) => Promise<{ customAppIconPath: string | null }>
}

let services: ConfigResourceServices | undefined
export function setConfigResourceServices(value: ConfigResourceServices): void { services = value }
export function getConfigResourceServices(): ConfigResourceServices | undefined { return services }
