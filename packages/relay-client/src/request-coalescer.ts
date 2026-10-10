import { canonicalJson, RequestCoalescer } from '@superone/shared/request-coalescer'

const READS = new Set(['get_git_info', 'get_system_info', 'get_project_resources', 'list_sessions', 'list_drafts', 'list_pinned_sessions'])

/** The phone's shared reads: these commands, alike but for their request id, under the same deadline. */
export function phoneReadKey(command: { type: string; [key: string]: unknown }, timeoutMs: number): string | null {
  if (!READS.has(command.type)) return null
  const { requestId: _requestId, ...parameters } = command
  return JSON.stringify([canonicalJson(parameters), timeoutMs])
}

export { RequestCoalescer }
