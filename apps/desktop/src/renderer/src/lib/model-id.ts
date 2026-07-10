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
