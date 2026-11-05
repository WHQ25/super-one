import { resolveGrokRuntime, type HarnessCatalogReader } from '@superone/runtime/harness'

/** Harness-stored grok binary when the catalog has one; otherwise the explicit path. */
export function resolveProductionAcpLaunch(opts: {
  harnesses?: HarnessCatalogReader | null
  acpBinaryPath?: string | null
}): { binaryPath?: string | null; args?: string[]; agentId?: string } {
  if (opts.harnesses) {
    const grok = resolveGrokRuntime(opts.harnesses, {
      command: opts.acpBinaryPath?.trim() || undefined,
    })
    if (grok) {
      return { binaryPath: grok.command, args: grok.args, agentId: 'grok-build' }
    }
  }
  return { binaryPath: opts.acpBinaryPath ?? null }
}
