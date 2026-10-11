import type { HarnessId, PermissionMode, SandboxMode } from '@superone/shared/agent-types'
import { sessionDefaultsForHarness } from '@superone/shared/harness/session-defaults'
import { readAppSettings } from '../app-settings-service'
import { coerceSandboxModeForCapability } from '../sandbox-platform'

/** Defaults for a newly created runtime, including this machine's sandbox support. */
export function readDefaultSessionPrefs(harnessId: HarnessId = 'claude'): { permissionMode: PermissionMode; sandboxMode: SandboxMode | undefined } {
  const defaults = sessionDefaultsForHarness(readAppSettings().agentPreference, harnessId)
  return { permissionMode: defaults.permissionMode, sandboxMode: coerceSandboxModeForCapability(defaults.sandboxMode ?? undefined) }
}
