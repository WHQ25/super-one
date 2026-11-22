import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type {
  ReviewFileContentsPair,
  ReviewFileDiff,
  ReviewSessionData,
  ReviewWorkspaceData,
  ReviewWorkspaceFilter,
} from '@superone/shared/review-types'
import {
  getLocalFileContentsPair,
  getWorkspaceFullDiff,
} from './git-private-snapshot'
import {
  countPatchLines,
  normalizePosixPath,
  sumFileDiffTotals,
  synthesizeAddedFilePatch,
} from './patch-utils'
import { buildTurnsFromTranscript, mergeFileDiffLists } from './tool-diff-extract'
import type { TurnDiffTracker } from './turn-diff-tracker'

async function getRemoteWorkspaceFullDiff(folderPath: string): Promise<ReviewWorkspaceData> {
  const { getEnvironmentHost } = await import('../environment')
  const {
    getRemoteGitDiffFile,
    getRemoteGitStatusFiles,
    readRemoteProjectFile,
  } = await import('../environment/remote-file-tree')
  const host = getEnvironmentHost()
  const statusFiles = (await getRemoteGitStatusFiles(host, folderPath)) ?? []
  const files: ReviewFileDiff[] = []

  for (const item of statusFiles) {
    const filePath = normalizePosixPath(item.path)
    const isUntracked = item.status === '?'
    if (isUntracked) {
      const read = await readRemoteProjectFile(host, folderPath, filePath)
      const isBinary = read?.language === 'binary' || read?.language === 'too-large' || read?.language === 'image'
      const patch = !isBinary && read?.content !== undefined
        ? synthesizeAddedFilePatch(filePath, read.content)
        : ''
      const counts = patch ? countPatchLines(patch) : { additions: 0, deletions: 0 }
      files.push({
        path: filePath,
        status: 'added',
        additions: counts.additions,
        deletions: counts.deletions,
        patch,
        ...(isBinary ? { isBinary: true } : {}),
        untracked: true,
        source: 'workspace-git',
      })
      continue
    }

    const diffRes = await getRemoteGitDiffFile(host, folderPath, filePath, item.staged)
    const rawDiff = diffRes?.diff ?? ''
    const counts = countPatchLines(rawDiff)
    const mappedStatus = item.status === 'A'
      ? 'added'
      : item.status === 'D'
        ? 'deleted'
        : item.status === 'R'
          ? 'renamed'
          : 'modified'
    files.push({
      path: filePath,
      status: mappedStatus,
      additions: counts.additions,
      deletions: counts.deletions,
      patch: rawDiff,
      staged: item.staged,
      unstaged: !item.staged,
      untracked: false,
      source: 'workspace-git',
    })
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  const totals = sumFileDiffTotals(files)
  return {
    root: folderPath,
    isRepo: true,
    files,
    totalAdditions: totals.additions,
    totalDeletions: totals.deletions,
  }
}

async function getRemoteFileContentsPair(
  folderPath: string,
  filePath: string,
): Promise<ReviewFileContentsPair> {
  const { getEnvironmentHost } = await import('../environment')
  const { readRemoteProjectFile } = await import('../environment/remote-file-tree')
  const host = getEnvironmentHost()
  const read = await readRemoteProjectFile(host, folderPath, filePath)
  const newContent = read && read.language !== 'binary' && read.language !== 'too-large'
    ? read.content
    : null
  return { oldContent: null, newContent, matchesDisk: newContent !== null }
}

export function registerReviewIpc(tracker: TurnDiffTracker): void {
  ipcMain.handle(
    AgentIpcChannels.REVIEW_GET_SESSION,
    async (_event, sessionId: string, folderPath: string, fallbackMessages?: unknown[]): Promise<ReviewSessionData> => {
      if (parseRemoteProjectKey(folderPath) && Array.isArray(fallbackMessages)) {
        const turns = buildTurnsFromTranscript(
          fallbackMessages as Parameters<typeof buildTurnsFromTranscript>[0],
          folderPath,
        )
        const sessionFiles = mergeFileDiffLists(turns.map((t) => t.files))
        const totals = sumFileDiffTotals(sessionFiles)
        return {
          sessionId,
          cwd: folderPath,
          turns,
          sessionFiles,
          sessionAdditions: totals.additions,
          sessionDeletions: totals.deletions,
          sessionSource: 'tool-fallback',
          hasConcurrentTurns: false,
        }
      }
      return tracker.getSessionReviewData(sessionId, folderPath)
    },
  )

  ipcMain.handle(
    AgentIpcChannels.REVIEW_GET_WORKSPACE,
    async (_event, folderPath: string, filter?: ReviewWorkspaceFilter): Promise<ReviewWorkspaceData> => {
      if (!folderPath) {
        return { root: '', isRepo: false, files: [], totalAdditions: 0, totalDeletions: 0 }
      }
      if (parseRemoteProjectKey(folderPath)) {
        return getRemoteWorkspaceFullDiff(folderPath)
      }
      return getWorkspaceFullDiff(folderPath, filter)
    },
  )

  ipcMain.handle(
    AgentIpcChannels.REVIEW_GET_FILE_CONTENTS,
    async (_event, folderPath: string, filePath: string): Promise<ReviewFileContentsPair> => {
      if (!folderPath || !filePath) {
        return { oldContent: null, newContent: null, matchesDisk: false }
      }
      if (parseRemoteProjectKey(folderPath)) {
        return getRemoteFileContentsPair(folderPath, filePath)
      }
      return getLocalFileContentsPair(folderPath, filePath)
    },
  )
}
