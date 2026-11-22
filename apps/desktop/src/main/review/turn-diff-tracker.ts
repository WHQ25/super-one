import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type {
  ReviewDiffSource,
  ReviewFileDiff,
  ReviewSessionData,
  ReviewTurnDiff,
} from '@superone/shared/review-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { loadSessionState, projectPathOfSession } from '../db-sessions'
import log from '../logger'
import type { SessionManagerImpl } from '../session/session-manager'
import {
  canonicalDirectory,
  capturePrivateTreeSnapshot,
  diffPrivateTrees,
  resolveGitRepoInfo,
  type GitRepoInfo,
} from './git-private-snapshot'
import { sumFileDiffTotals } from './patch-utils'
import {
  buildTurnsFromTranscript,
  extractTurnToolDiffs,
  extractTurnToolTouchedPaths,
  mergeFileDiffLists,
} from './tool-diff-extract'
import {
  listTurnDiffs,
  loadSessionNetDiff,
  saveSessionNetDiff,
  saveTurnDiff,
} from './turn-diff-repo'

interface ActiveTurnState {
  sessionId: string
  turnIndex: number
  userMessageId: string
  promptPreview: string
  cwd: string
  canonicalCwd: string
  repo: GitRepoInfo | null
  beforeTreePromise: Promise<string | null>
  concurrent: boolean
  peerSessionIds: Set<string>
  startMessageCount: number
}

interface SessionSnapshotBook {
  snapshotDir: string
  repo: GitRepoInfo | null
  firstBeforeTree: string | null
  hasConcurrentTurns: boolean
  nextTurnIndex: number
}

function promptPreviewFromMessage(msg: ChatMessage): string {
  for (const block of msg.content ?? []) {
    if (block.type === 'text' && block.text.trim()) {
      const compact = block.text.trim().replace(/\s+/g, ' ')
      return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact
    }
  }
  return ''
}

export class TurnDiffTracker {
  private activeTurns = new Map<string, ActiveTurnState>()
  private activeByCwd = new Map<string, Set<string>>()
  private sessionBooks = new Map<string, SessionSnapshotBook>()
  private unsub: (() => void) | null = null

  constructor(private readonly sessionManager: SessionManagerImpl) {}

  attach(): void {
    if (this.unsub) return
    this.unsub = this.sessionManager.onAny((sessionId, event, replay) => {
      if (replay) return
      void this.handleEvent(sessionId, event)
    })
  }

  dispose(): void {
    this.unsub?.()
    this.unsub = null
    const dirs = Array.from(this.sessionBooks.values()).map((b) => b.snapshotDir)
    this.sessionBooks.clear()
    this.activeTurns.clear()
    this.activeByCwd.clear()
    for (const dir of dirs) {
      void rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  cleanupSession(sessionId: string): void {
    const active = this.activeTurns.get(sessionId)
    if (active) {
      this.removeActiveCwd(active.canonicalCwd, sessionId)
      this.activeTurns.delete(sessionId)
    }
    const book = this.sessionBooks.get(sessionId)
    if (book) {
      this.sessionBooks.delete(sessionId)
      void rm(book.snapshotDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private addActiveCwd(canonicalCwd: string, sessionId: string): Set<string> {
    let set = this.activeByCwd.get(canonicalCwd)
    if (!set) {
      set = new Set()
      this.activeByCwd.set(canonicalCwd, set)
    }
    const peers = new Set<string>()
    for (const existingId of set) {
      if (existingId === sessionId) continue
      peers.add(existingId)
      const peerTurn = this.activeTurns.get(existingId)
      if (peerTurn) {
        peerTurn.concurrent = true
        peerTurn.peerSessionIds.add(sessionId)
      }
      const peerBook = this.sessionBooks.get(existingId)
      if (peerBook) peerBook.hasConcurrentTurns = true
    }
    set.add(sessionId)
    return peers
  }

  private removeActiveCwd(canonicalCwd: string, sessionId: string): void {
    const set = this.activeByCwd.get(canonicalCwd)
    if (!set) return
    set.delete(sessionId)
    if (set.size === 0) this.activeByCwd.delete(canonicalCwd)
  }

  private getOrCreateBook(sessionId: string, existingTurnCount: number): SessionSnapshotBook {
    const existing = this.sessionBooks.get(sessionId)
    if (existing) return existing
    const book: SessionSnapshotBook = {
      snapshotDir: join(tmpdir(), `superone-review-snap-${sessionId}`),
      repo: null,
      firstBeforeTree: null,
      hasConcurrentTurns: false,
      nextTurnIndex: existingTurnCount + 1,
    }
    this.sessionBooks.set(sessionId, book)
    return book
  }

  private async handleEvent(sessionId: string, event: AgentEvent): Promise<void> {
    if (event.type === 'user_message_appended') {
      await this.onTurnStart(sessionId, event.message)
      return
    }
    if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error'
    ) {
      const assistantMessageId = 'messageId' in event && typeof event.messageId === 'string'
        ? event.messageId
        : null
      await this.onTurnEnd(sessionId, assistantMessageId)
    }
  }

  private async onTurnStart(sessionId: string, userMessage: ChatMessage): Promise<void> {
    const session = this.sessionManager.getSession(sessionId)
    if (!session) return
    const snapshot = session.snapshot
    const cwd = snapshot.cwd || snapshot.projectPath
    if (!cwd || parseRemoteProjectKey(cwd)) return

    const existingActive = this.activeTurns.get(sessionId)
    if (existingActive) {
      this.removeActiveCwd(existingActive.canonicalCwd, sessionId)
      this.activeTurns.delete(sessionId)
    }

    const storedTurns = listTurnDiffs(sessionId)
    const book = this.getOrCreateBook(sessionId, storedTurns.length)
    const turnIndex = book.nextTurnIndex
    book.nextTurnIndex += 1

    const canonicalCwd = await canonicalDirectory(cwd)
    const peers = this.addActiveCwd(canonicalCwd, sessionId)
    const concurrent = peers.size > 0
    if (concurrent) book.hasConcurrentTurns = true

    const repo = await resolveGitRepoInfo(canonicalCwd)
    if (repo && !book.repo) book.repo = repo

    const beforeTreePromise = repo
      ? capturePrivateTreeSnapshot(repo, book.snapshotDir).then((tree) => {
          if (tree && !book.firstBeforeTree) book.firstBeforeTree = tree
          return tree
        })
      : Promise.resolve(null)

    const startMessageCount = snapshot.messages.length

    this.activeTurns.set(sessionId, {
      sessionId,
      turnIndex,
      userMessageId: userMessage.id,
      promptPreview: promptPreviewFromMessage(userMessage),
      cwd,
      canonicalCwd,
      repo,
      beforeTreePromise,
      concurrent,
      peerSessionIds: peers,
      startMessageCount,
    })
  }

  private collectPeerTouchedPaths(peerIds: ReadonlySet<string>, rootDir: string): Set<string> {
    const touched = new Set<string>()
    for (const peerId of peerIds) {
      const peerSession = this.sessionManager.getSession(peerId)
      if (!peerSession) continue
      const peerActive = this.activeTurns.get(peerId)
      const msgs = peerActive
        ? peerSession.snapshot.messages.slice(Math.max(0, peerActive.startMessageCount - 1))
        : peerSession.snapshot.messages.slice(-4)
      for (const p of extractTurnToolTouchedPaths(msgs, rootDir)) {
        touched.add(p)
      }
    }
    return touched
  }

  private async onTurnEnd(sessionId: string, assistantMessageId: string | null): Promise<void> {
    const active = this.activeTurns.get(sessionId)
    if (!active) return
    this.activeTurns.delete(sessionId)
    this.removeActiveCwd(active.canonicalCwd, sessionId)

    const session = this.sessionManager.getSession(sessionId)
    const allMessages = session?.snapshot.messages ?? []
    const turnMessages = allMessages.slice(Math.max(0, active.startMessageCount - 1))
    const book = this.sessionBooks.get(sessionId)
    const rootDir = active.repo?.repoRoot ?? active.canonicalCwd

    const beforeTree = await active.beforeTreePromise.catch(() => null)
    const afterTree = active.repo && book
      ? await capturePrivateTreeSnapshot(active.repo, book.snapshotDir).catch(() => null)
      : null

    let files: ReviewFileDiff[] = []
    let source: ReviewDiffSource = 'tool-fallback'

    if (active.repo && book && beforeTree && afterTree) {
      const snapshotFiles = await diffPrivateTrees(active.repo, book.snapshotDir, beforeTree, afterTree)
      if (!active.concurrent) {
        files = snapshotFiles
        source = 'git-snapshot'
      } else {
        source = 'git-filtered'
        const ownTouched = extractTurnToolTouchedPaths(turnMessages, rootDir)
        const peerTouched = this.collectPeerTouchedPaths(active.peerSessionIds, rootDir)
        const ownToolDiffs = new Map(
          extractTurnToolDiffs(turnMessages, rootDir).map((f) => [f.path, f]),
        )
        const filtered: ReviewFileDiff[] = []
        for (const file of snapshotFiles) {
          const touchedByPeer = peerTouched.has(file.path)
          const touchedBySelf = ownTouched.has(file.path)
          if (touchedByPeer && !touchedBySelf) continue
          if (touchedByPeer && touchedBySelf) {
            const fallback = ownToolDiffs.get(file.path)
            if (fallback) {
              filtered.push({ ...fallback, source: 'git-filtered' })
              continue
            }
          }
          filtered.push({ ...file, source: 'git-filtered' })
        }
        for (const [path, toolFile] of ownToolDiffs) {
          if (!filtered.some((f) => f.path === path)) {
            filtered.push({ ...toolFile, source: 'git-filtered' })
          }
        }
        filtered.sort((a, b) => a.path.localeCompare(b.path))
        files = filtered
      }
    } else {
      files = extractTurnToolDiffs(turnMessages, rootDir)
      source = 'tool-fallback'
    }

    const totals = sumFileDiffTotals(files)
    const turnRecord: ReviewTurnDiff = {
      turnIndex: active.turnIndex,
      userMessageId: active.userMessageId,
      assistantMessageId,
      promptPreview: active.promptPreview,
      cwd: rootDir,
      source,
      concurrent: active.concurrent,
      createdAt: Date.now(),
      files,
      totalAdditions: totals.additions,
      totalDeletions: totals.deletions,
    }

    try {
      saveTurnDiff(sessionId, turnRecord)
    } catch (err) {
      log.warn('[TurnDiffTracker] failed to persist turn diff sid=%s:', sessionId, err)
    }

    await this.updateSessionNetDiff(sessionId, rootDir, active.repo, book ?? null, afterTree)
  }

  private async updateSessionNetDiff(
    sessionId: string,
    cwd: string,
    repo: GitRepoInfo | null,
    book: SessionSnapshotBook | null,
    latestAfterTree: string | null,
  ): Promise<void> {
    const turns = listTurnDiffs(sessionId)
    const hasConcurrentTurns = book?.hasConcurrentTurns === true || turns.some((t) => t.concurrent)

    let netFiles: ReviewFileDiff[] = []
    let netSource: ReviewDiffSource = 'tool-fallback'

    if (repo && book && book.firstBeforeTree && latestAfterTree && !hasConcurrentTurns) {
      netFiles = await diffPrivateTrees(repo, book.snapshotDir, book.firstBeforeTree, latestAfterTree)
      netSource = 'git-snapshot'
    } else {
      netFiles = mergeFileDiffLists(turns.map((t) => t.files))
      netSource = hasConcurrentTurns ? 'git-filtered' : turns[turns.length - 1]?.source ?? 'tool-fallback'
    }

    const totals = sumFileDiffTotals(netFiles)
    try {
      saveSessionNetDiff({
        sessionId,
        cwd,
        source: netSource,
        hasConcurrentTurns,
        files: netFiles,
        totalAdditions: totals.additions,
        totalDeletions: totals.deletions,
        updatedAt: Date.now(),
      })
    } catch (err) {
      log.warn('[TurnDiffTracker] failed to persist session net diff sid=%s:', sessionId, err)
    }
  }

  getSessionReviewData(sessionId: string, fallbackCwd: string): ReviewSessionData {
    const persistedTurns = listTurnDiffs(sessionId)
    const persistedNet = loadSessionNetDiff(sessionId)

    const liveSession = this.sessionManager.getSession(sessionId)
    const storedState = !liveSession ? loadSessionState(sessionId) : null
    const messages = liveSession?.snapshot.messages ?? storedState?.messages ?? []
    const cwd = liveSession?.snapshot.cwd
      ?? storedState?.worktreePath
      ?? projectPathOfSession(sessionId)
      ?? persistedNet?.cwd
      ?? fallbackCwd

    if (persistedTurns.length === 0 && messages.length > 0) {
      const synthesizedTurns = buildTurnsFromTranscript(messages, cwd)
      const mergedFiles = mergeFileDiffLists(synthesizedTurns.map((t) => t.files))
      const totals = sumFileDiffTotals(mergedFiles)
      return {
        sessionId,
        cwd,
        turns: synthesizedTurns,
        sessionFiles: mergedFiles,
        sessionAdditions: totals.additions,
        sessionDeletions: totals.deletions,
        sessionSource: 'tool-fallback',
        hasConcurrentTurns: false,
      }
    }

    const sessionFiles = persistedNet
      ? persistedNet.files
      : mergeFileDiffLists(persistedTurns.map((t) => t.files))
    const totals = persistedNet
      ? { additions: persistedNet.totalAdditions, deletions: persistedNet.totalDeletions }
      : sumFileDiffTotals(sessionFiles)

    return {
      sessionId,
      cwd: persistedNet?.cwd || cwd,
      turns: persistedTurns,
      sessionFiles,
      sessionAdditions: totals.additions,
      sessionDeletions: totals.deletions,
      sessionSource: persistedNet?.source ?? persistedTurns[persistedTurns.length - 1]?.source ?? 'tool-fallback',
      hasConcurrentTurns: persistedNet?.hasConcurrentTurns ?? persistedTurns.some((t) => t.concurrent),
    }
  }
}
