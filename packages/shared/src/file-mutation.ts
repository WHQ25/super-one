/**
 * What counts as a file edit for the turn's diff stat (files changed, +N −M).
 * Names are post-`normalizeTranscriptTool`: Grok `write_file` / `search_replace`
 * already fold onto `Write` / `Edit` before they get here. `Delete` is the row a
 * Bash call's `bashEditDiff` synthesizes for a removed file (see bash-edit-diff).
 */
export const FILE_MUTATION_TOOLS = new Set(['Edit', 'Write', 'FileChange', 'NotebookEdit', 'Delete'])

export function isFileMutationTool(normalizedToolName: string): boolean {
  return FILE_MUTATION_TOOLS.has(normalizedToolName)
}

export function fileMutationPath(params: Record<string, unknown>): string {
  const raw = params.file_path ?? params.notebook_path ?? params.target_file ?? params.path
  return typeof raw === 'string' ? raw : ''
}
