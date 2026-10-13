import type { SandboxProbeResult } from '@superone/shared/agent-types'
import { probeSandboxDependencies as probeRuntimeSandbox } from '@superone/runtime/sandbox'
import { ensureShellPath } from './shell-path'

// One probe for the window and every node client (`sandbox.probe`).
export { coerceSandboxModeForCapability, getSandboxCapability, isSandboxEnableAllowed } from '@superone/runtime/sandbox'

/** The probe result is cached, so bwrap / socat are looked up on the full PATH. */
export async function probeSandboxDependencies(): Promise<SandboxProbeResult> {
  await ensureShellPath()
  return probeRuntimeSandbox()
}
