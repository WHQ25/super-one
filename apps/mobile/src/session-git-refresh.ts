import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'
import type { ShellGitInfo } from './project-types'

export type GitTurnSnapshot = {
  sessionId: string | null
  streaming: boolean
}

/**
 * The agent is the only actor that changes the working tree without telling
 * us, and it can only do so during a turn. A refresh belongs at that boundary
 * — same session, streaming → idle — not when the user merely switches chats.
 * Switching back is a separate call site: the phone was not watching the
 * other session's turn end.
 */
export function gitTurnEnded(prev: GitTurnSnapshot, next: GitTurnSnapshot): boolean {
  return Boolean(prev.sessionId)
    && prev.sessionId === next.sessionId
    && prev.streaming
    && !next.streaming
}

export async function fetchProjectGitInfo(
  client: RelayClient,
  projectPath: string,
): Promise<ShellGitInfo | null> {
  return await client.request({
    type: 'get_git_info',
    requestId: randomId(),
    projectPath,
  } as RemoteCommand).catch(() => null) as ShellGitInfo | null
}
