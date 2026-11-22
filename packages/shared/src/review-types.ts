export type ReviewScope = 'turn' | 'session' | 'workspace'

export type ReviewWorkspaceMode = 'uncommitted' | 'unstaged' | 'staged' | 'commit' | 'branch'

export interface ReviewWorkspaceFilter {
  mode?: ReviewWorkspaceMode
  commitSha?: string
}

export interface ReviewRepoInfo {
  path: string
  name: string
  branch: string | null
  isMain: boolean
}

export interface ReviewCommitInfo {
  sha: string
  shortSha: string
  subject: string
  relativeTime: string
}

export type ReviewFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export type ReviewDiffSource = 'git-snapshot' | 'git-filtered' | 'tool-fallback' | 'workspace-git'

export interface ReviewFileDiff {
  path: string
  oldPath?: string
  status: ReviewFileStatus
  additions: number
  deletions: number
  patch: string
  isBinary?: boolean
  staged?: boolean
  unstaged?: boolean
  untracked?: boolean
  source?: ReviewDiffSource
}

export interface ReviewTurnDiff {
  turnIndex: number
  userMessageId: string
  assistantMessageId: string | null
  promptPreview: string
  cwd: string
  source: ReviewDiffSource
  concurrent: boolean
  createdAt: number
  files: ReviewFileDiff[]
  totalAdditions: number
  totalDeletions: number
}

export interface ReviewSessionData {
  sessionId: string
  cwd: string
  turns: ReviewTurnDiff[]
  sessionFiles: ReviewFileDiff[]
  sessionAdditions: number
  sessionDeletions: number
  sessionSource: ReviewDiffSource
  hasConcurrentTurns: boolean
}

export interface ReviewWorkspaceData {
  root: string
  isRepo: boolean
  files: ReviewFileDiff[]
  totalAdditions: number
  totalDeletions: number
  currentBranch?: string | null
  baseBranch?: string | null
  repos?: ReviewRepoInfo[]
  recentCommits?: ReviewCommitInfo[]
}

export interface ReviewFileContentsPair {
  oldContent: string | null
  newContent: string | null
  matchesDisk: boolean
}
