/**
 * `@cursor/sdk` costs ~100ms to import and most installs never enable Cursor,
 * so it loads on first use instead of with the host's main bundle. Import
 * SDK values through here; `import type` from the SDK stays free.
 */
type CursorSdk = typeof import('@cursor/sdk')
type CursorSdkErrorName = 'AgentBusyError' | 'IntegrationNotConnectedError'

let pending: Promise<CursorSdk> | null = null
let loaded: CursorSdk | null = null

export function loadCursorSdk(): Promise<CursorSdk> {
  pending ??= import('@cursor/sdk').then((sdk) => (loaded = sdk))
  return pending
}

/** Sync `instanceof` for SDK errors: one can only exist once the SDK has loaded. */
export function isCursorSdkError<K extends CursorSdkErrorName>(
  error: unknown,
  name: K,
): error is InstanceType<CursorSdk[K]> {
  return loaded !== null && error instanceof loaded[name]
}
