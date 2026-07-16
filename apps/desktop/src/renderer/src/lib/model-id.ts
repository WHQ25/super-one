// Claude Code enables the 1M-token context beta (`context-1m-2025-08-07`) when a model id ends in
// `[1m]`; it strips the suffix and adds the beta header. Catalog ids never carry it, so compare
// against the base id (suffix stripped) when matching mapping ids to catalog models.
export const ONE_M_SUFFIX = '[1m]'

export function stripOneM(id: string): string {
  return id.endsWith(ONE_M_SUFFIX) ? id.slice(0, -ONE_M_SUFFIX.length) : id
}

export function hasOneM(id: string): boolean {
  return id.endsWith(ONE_M_SUFFIX)
}

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
