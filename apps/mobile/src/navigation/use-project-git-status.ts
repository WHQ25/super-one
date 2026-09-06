import { useCallback, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import type { GitFileStatusEntry, GitFileTone } from '@superone/shared/git-file-status'
import { gitFileTone, strongestGitTone } from '@superone/shared/git-file-status'
import { randomId } from '../ids'

/**
 * Per-file git state for the file browser, keyed by repo-relative path.
 *
 * Folders carry the loudest tone beneath them so a collapsed directory still
 * says something changed inside — the same thing the desktop tree does by
 * colouring the folder row.
 */
export type GitToneMap = {
  files: Map<string, { tone: GitFileTone; staged: boolean; partiallyStaged: boolean }>
  directories: Map<string, GitFileTone>
}

const EMPTY: GitToneMap = { files: new Map(), directories: new Map() }

export function buildGitToneMap(entries: GitFileStatusEntry[]): GitToneMap {
  const files = new Map<string, { tone: GitFileTone; staged: boolean; partiallyStaged: boolean }>()
  const perDirectory = new Map<string, GitFileTone[]>()
  for (const entry of entries) {
    const state = gitFileTone(entry.index, entry.worktree)
    if (!state) continue
    files.set(entry.path, state)
    const segments = entry.path.split('/')
    // Every ancestor, not just the immediate parent: a change three levels down
    // still has to reach the folder the user is currently looking at.
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join('/')
      const bucket = perDirectory.get(dir)
      if (bucket) bucket.push(state.tone)
      else perDirectory.set(dir, [state.tone])
    }
  }
  const directories = new Map<string, GitFileTone>()
  for (const [dir, tones] of perDirectory) {
    const tone = strongestGitTone(tones)
    if (tone) directories.set(dir, tone)
  }
  return { files, directories }
}

export function useProjectGitStatus(clientRef: RefObject<RelayClient | null>) {
  const [tones, setTones] = useState<GitToneMap>(EMPTY)
  const generation = useRef(0)
  const refresh = useCallback(async (projectPath: string): Promise<void> => {
    const client = clientRef.current
    if (!client || !projectPath) return
    const request = ++generation.current
    const result = await client.request({
      type: 'get_git_file_status', requestId: randomId(), projectPath,
    } as RemoteCommand) as { entries?: GitFileStatusEntry[] }
    if (request !== generation.current) return
    setTones(buildGitToneMap(result.entries ?? []))
  }, [clientRef])
  const clear = useCallback(() => { generation.current++; setTones(EMPTY) }, [])
  return { tones, refresh, clear }
}
