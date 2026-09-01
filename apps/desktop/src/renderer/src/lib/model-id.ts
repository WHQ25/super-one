// The `[1m]` suffix contract lives in @superone/shared/agent-types so the main
// process (which strips it off the alias when a provider mapping is live) and
// the renderer read the same definition. Re-exported here for renderer imports.
import { hasOneM, stripOneM } from '@superone/shared/agent-types'

export { ONE_M_SUFFIX, hasOneM, stripOneM } from '@superone/shared/agent-types'

/**
 * Model ids eligible for the UI `[1m]` long-context toggle.
 * - Catalog models with contextWindow >= 1M (e.g. kimi-k3)
 * - Base ids of plan preset mappings that ship with `[1m]` (e.g. k3 from k3[1m] on Kimi Coding)
 *   — coding-plan ids often differ from catalog ids.
 */
export function collectOneMillionIds(
  catalogModels: ReadonlyArray<{ id: string; contextWindow?: number }>,
  planModelMappings: ReadonlyArray<Record<string, { id?: string } | undefined | null> | undefined | null>,
): Set<string> {
  const ids = new Set<string>()
  for (const m of catalogModels) {
    if ((m.contextWindow ?? 0) >= 1_000_000) ids.add(m.id)
  }
  for (const mapping of planModelMappings) {
    if (!mapping) continue
    for (const slot of Object.values(mapping)) {
      const id = slot?.id
      if (id && hasOneM(id)) ids.add(stripOneM(id))
    }
  }
  return ids
}
