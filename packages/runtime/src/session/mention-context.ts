import type { ChatMessage } from '@superone/shared/agent-types'
import { parseGitMentionValue, parseGitHubIssueOrPrUrl } from '@superone/shared/git-mention-query'
import { GIT_HOST_TAG_REGEX, gitTagValue } from '@superone/shared/git-mention-tags'
import { SESSION_TAG_REGEX, wrapSessionMention } from '@superone/shared/miniapp-prompt-tags'
import { formatTextBlocks, pageTextBlocks, sliceMessagesUpTo } from '@superone/shared/session-transcript-view'

export const MENTION_CONTEXT_GH_TIMEOUT_MS = 8_000
const MAX_GITHUB_MENTIONS = 5
const MAX_SESSION_MENTIONS = 5
const MAX_GH_BODY_CHARS = 4_000
const MAX_GH_COMMENT_CHARS = 800
const MAX_GH_COMMENTS = 8
const MAX_GH_FILES = 30
const MAX_GH_ITEM_CHARS = 12_000
const MAX_SESSION_TRANSCRIPT_CHARS = 6_000
const MAX_SESSION_TEXT_BLOCKS = 12

const GH_ISSUE_JSON_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'labels',
  'assignees',
  'milestone',
  'createdAt',
  'updatedAt',
  'url',
  'body',
  'comments',
].join(',')

const GH_PR_JSON_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'author',
  'baseRefName',
  'headRefName',
  'labels',
  'reviewDecision',
  'mergeable',
  'additions',
  'deletions',
  'changedFiles',
  'createdAt',
  'updatedAt',
  'url',
  'body',
  'files',
  'comments',
  'reviews',
  'statusCheckRollup',
].join(',')

export interface GitHubMentionTarget {
  kind: 'issue' | 'pr'
  id: string
}

export interface MentionedSessionData {
  sessionId: string
  title?: string | null
  harness?: string | null
  model?: string | null
  branch?: string | null
  createdAt?: string | number | null
  lastActiveAt?: string | number | null
  messageCount?: number
  tags?: readonly string[]
  messages: readonly ChatMessage[]
}

export interface MentionContextDeps {
  gh?: (args: string[]) => Promise<string>
  readSession?: (sessionId: string) => MentionedSessionData | null | Promise<MentionedSessionData | null>
  skipSessionId?: string
}

interface GhUser {
  login?: string
  name?: string
}

interface GhLabel {
  name?: string
}

interface GhComment {
  author?: GhUser
  body?: string
  createdAt?: string
}

interface GhReview {
  author?: GhUser
  state?: string
  body?: string
  submittedAt?: string
}

interface GhFile {
  path?: string
  additions?: number
  deletions?: number
}

interface GhStatusCheck {
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
}

interface GhIssuePayload {
  number?: number
  title?: string
  state?: string
  author?: GhUser
  labels?: GhLabel[]
  assignees?: GhUser[]
  milestone?: { title?: string } | null
  createdAt?: string
  updatedAt?: string
  url?: string
  body?: string
  comments?: GhComment[]
}

interface GhPrPayload extends GhIssuePayload {
  isDraft?: boolean
  baseRefName?: string
  headRefName?: string
  reviewDecision?: string
  mergeable?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  files?: GhFile[]
  reviews?: GhReview[]
  statusCheckRollup?: GhStatusCheck[]
}

function truncateHead(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars).trimEnd()}\n... (truncated, ${trimmed.length} chars total)`
}

function truncateTail(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const omitted = trimmed.length - maxChars
  return `... (${omitted} earlier chars omitted)\n${trimmed.slice(-maxChars).trimStart()}`
}

function formatUser(user?: GhUser): string | undefined {
  return user?.login?.trim() || user?.name?.trim() || undefined
}

function formatIso(value?: string | number | null): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString() : undefined
  }
  return value.trim() || undefined
}

export function hasMentionContextTargets(text: string): boolean {
  return text.includes('<superone-github>') || text.includes('<superone-session>')
}

export function extractGitHubMentionTargets(text: string): GitHubMentionTarget[] {
  const targets: GitHubMentionTarget[] = []
  const seen = new Set<string>()
  const re = new RegExp(GIT_HOST_TAG_REGEX)
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match[1] !== 'github') continue
    const encoded = gitTagValue(match[2], match[4], match[1])
    if (!encoded) continue
    const parsed = parseGitMentionValue(encoded)
    if (!parsed || (parsed.kind !== 'issue' && parsed.kind !== 'pr')) continue
    const key = `${parsed.kind}:${parsed.id}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ kind: parsed.kind, id: parsed.id })
    if (targets.length >= MAX_GITHUB_MENTIONS) break
  }
  return targets
}

export interface SessionMentionTarget {
  sessionId: string
  upToMessageId?: string
}

export interface ForkContextMeta {
  sourceSessionId: string
  forkFromMessageId?: string
  pendingPreamble?: string
}

export function buildMentionForkPreamble(input: {
  sourceSessionId: string
  sourceTitle?: string | null
  forkFromMessageId?: string
  mode: 'worktree' | 'local' | 'side-chat'
}): string {
  const title = input.sourceTitle?.trim() || 'Session'
  const mention = wrapSessionMention(input.sourceSessionId, title, input.forkFromMessageId)
  const cutoff = input.forkFromMessageId?.trim()
  const lines: string[] = []
  if (input.mode === 'side-chat') {
    lines.push(
      `Parent session reference: ${mention}`,
      `The parent conversation context is attached below via <superone-session-context>. Use session_read({ sessionId: "${input.sourceSessionId}", view: "meta" | "user" | "assistant" | "text" | "tools" | "tool_detail" }) if you need earlier messages or full tool details.`,
    )
  } else {
    const location = input.mode === 'worktree'
      ? 'a new isolated git worktree'
      : 'the same working directory'
    lines.push(
      `# Forked Session`,
      `This session was forked from ${mention} and is running in ${location}.`,
      `The prior conversation context is attached below via <superone-session-context>. Continue seamlessly from that history as if it happened in this conversation, and use session_read({ sessionId: "${input.sourceSessionId}", view: "meta" | "user" | "assistant" | "text" | "tools" | "tool_detail" }) on demand if you need earlier messages or full tool details.`,
    )
  }
  if (cutoff) {
    lines.push(
      `Branch cutoff: this fork branches at messageId "${cutoff}". Do NOT read, request, or reference any messages or events after messageId "${cutoff}" in session "${input.sourceSessionId}". When calling session_read on "${input.sourceSessionId}", stay at or before messageId "${cutoff}".`,
    )
  }
  return lines.join('\n')
}

export function extractSessionMentionTargets(text: string, skipSessionId?: string): SessionMentionTarget[] {
  const targets: SessionMentionTarget[] = []
  const seen = new Set<string>()
  const re = new RegExp(SESSION_TAG_REGEX)
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const id = match[2].trim()
    const upToMessageId = match[3]?.trim() || undefined
    if (!id || id === skipSessionId) continue
    const key = `${id}:${upToMessageId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ sessionId: id, ...(upToMessageId ? { upToMessageId } : {}) })
    if (targets.length >= MAX_SESSION_MENTIONS) break
  }
  return targets
}

export function extractSessionMentionIds(text: string, skipSessionId?: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const target of extractSessionMentionTargets(text, skipSessionId)) {
    if (seen.has(target.sessionId)) continue
    seen.add(target.sessionId)
    ids.push(target.sessionId)
  }
  return ids
}

function formatCommentsSection(
  entries: Array<{ author?: string; at?: string; label?: string; body: string }>,
): string[] {
  if (entries.length === 0) return []
  const omitted = entries.length > MAX_GH_COMMENTS ? entries.length - MAX_GH_COMMENTS : 0
  const recent = entries.slice(-MAX_GH_COMMENTS)
  const lines = [
    omitted > 0
      ? `Recent comments (last ${recent.length} of ${entries.length}):`
      : `Comments (${recent.length}):`,
  ]
  for (const entry of recent) {
    const meta = [entry.author ? `@${entry.author}` : 'unknown', entry.label, entry.at]
      .filter(Boolean)
      .join(' · ')
    lines.push(`- [${meta}]\n  ${truncateHead(entry.body, MAX_GH_COMMENT_CHARS).replace(/\n/g, '\n  ')}`)
  }
  return lines
}

function summarizeStatusChecks(checks?: GhStatusCheck[]): string | undefined {
  if (!checks || checks.length === 0) return undefined
  let passed = 0
  let pending = 0
  const failedNames: string[] = []
  for (const c of checks) {
    const conclusion = (c.conclusion ?? c.state ?? '').toUpperCase()
    const status = (c.status ?? '').toUpperCase()
    const name = c.name || c.context || 'check'
    if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') {
      passed += 1
    } else if (
      conclusion === 'FAILURE'
      || conclusion === 'ERROR'
      || conclusion === 'TIMED_OUT'
      || conclusion === 'CANCELLED'
      || conclusion === 'ACTION_REQUIRED'
    ) {
      failedNames.push(name)
    } else if (status === 'IN_PROGRESS' || status === 'QUEUED' || status === 'PENDING' || conclusion === 'PENDING') {
      pending += 1
    } else {
      passed += 1
    }
  }
  const parts: string[] = []
  if (passed > 0) parts.push(`${passed} passed`)
  if (pending > 0) parts.push(`${pending} pending`)
  if (failedNames.length > 0) {
    const shown = failedNames.slice(0, 5).join(', ')
    const extra = failedNames.length > 5 ? ` (+${failedNames.length - 5} more)` : ''
    parts.push(`${failedNames.length} failed (${shown}${extra})`)
  }
  return parts.join(', ')
}

function formatGhIssue(target: GitHubMentionTarget, raw: string): string | null {
  const item = JSON.parse(raw) as GhIssuePayload
  const num = item.number ?? target.id
  const lines: string[] = [`### Issue #${num}: ${item.title ?? ''}`]
  const meta: string[] = []
  if (item.state) meta.push(`state: ${item.state}`)
  const author = formatUser(item.author)
  if (author) meta.push(`author: @${author}`)
  const labels = (item.labels ?? []).map((l) => l.name).filter(Boolean)
  if (labels.length > 0) meta.push(`labels: ${labels.join(', ')}`)
  const assignees = (item.assignees ?? []).map(formatUser).filter(Boolean)
  if (assignees.length > 0) meta.push(`assignees: ${assignees.map((a) => `@${a}`).join(', ')}`)
  if (item.milestone?.title) meta.push(`milestone: ${item.milestone.title}`)
  if (item.updatedAt) meta.push(`updated: ${item.updatedAt}`)
  if (meta.length > 0) lines.push(meta.join(' · '))
  if (item.url) lines.push(`url: ${item.url}`)
  if (item.body?.trim()) {
    lines.push('', 'Body:', truncateHead(item.body, MAX_GH_BODY_CHARS))
  }
  const comments = (item.comments ?? [])
    .filter((c) => c.body?.trim())
    .map((c) => ({ author: formatUser(c.author), at: c.createdAt, body: c.body!.trim() }))
  const commentLines = formatCommentsSection(comments)
  if (commentLines.length > 0) lines.push('', ...commentLines)
  return truncateHead(lines.join('\n'), MAX_GH_ITEM_CHARS)
}

function formatGhPr(target: GitHubMentionTarget, raw: string): string | null {
  const item = JSON.parse(raw) as GhPrPayload
  const num = item.number ?? target.id
  const lines: string[] = [`### PR #${num}: ${item.title ?? ''}`]
  const state = item.isDraft ? 'DRAFT' : item.state
  const meta: string[] = []
  if (state) meta.push(`state: ${state}`)
  if (item.baseRefName || item.headRefName) {
    meta.push(`branches: ${item.baseRefName ?? '?'} <- ${item.headRefName ?? '?'}`)
  }
  const author = formatUser(item.author)
  if (author) meta.push(`author: @${author}`)
  const labels = (item.labels ?? []).map((l) => l.name).filter(Boolean)
  if (labels.length > 0) meta.push(`labels: ${labels.join(', ')}`)
  if (item.reviewDecision) meta.push(`review: ${item.reviewDecision}`)
  if (item.mergeable) meta.push(`mergeable: ${item.mergeable}`)
  if (typeof item.changedFiles === 'number') {
    meta.push(`diffstat: +${item.additions ?? 0}/-${item.deletions ?? 0} across ${item.changedFiles} files`)
  }
  const checks = summarizeStatusChecks(item.statusCheckRollup)
  if (checks) meta.push(`checks: ${checks}`)
  if (meta.length > 0) lines.push(meta.join(' · '))
  if (item.url) lines.push(`url: ${item.url}`)
  if (item.body?.trim()) {
    lines.push('', 'Body:', truncateHead(item.body, MAX_GH_BODY_CHARS))
  }
  const files = (item.files ?? []).filter((f) => f.path)
  if (files.length > 0) {
    const shown = files.slice(0, MAX_GH_FILES)
    lines.push('', `Changed files (${files.length}):`)
    for (const f of shown) {
      lines.push(`- ${f.path} (+${f.additions ?? 0}/-${f.deletions ?? 0})`)
    }
    if (files.length > shown.length) {
      lines.push(`- ... and ${files.length - shown.length} more files`)
    }
  }
  const comments = (item.comments ?? [])
    .filter((c) => c.body?.trim())
    .map((c) => ({ author: formatUser(c.author), at: c.createdAt, body: c.body!.trim() }))
  const reviews = (item.reviews ?? [])
    .filter((r) => r.body?.trim())
    .map((r) => ({
      author: formatUser(r.author),
      at: r.submittedAt,
      label: r.state ? `review:${r.state}` : 'review',
      body: r.body!.trim(),
    }))
  const discussion = [...comments, ...reviews].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  const discussionLines = formatCommentsSection(discussion)
  if (discussionLines.length > 0) lines.push('', ...discussionLines)
  return truncateHead(lines.join('\n'), MAX_GH_ITEM_CHARS)
}

async function resolveGitHubItem(
  target: GitHubMentionTarget,
  gh: (args: string[]) => Promise<string>,
): Promise<string | null> {
  try {
    const fields = target.kind === 'pr' ? GH_PR_JSON_FIELDS : GH_ISSUE_JSON_FIELDS
    const viewTarget = parseGitHubIssueOrPrUrl(target.id)?.canonicalUrl ?? target.id
    const raw = await gh([target.kind, 'view', viewTarget, '--json', fields])
    return target.kind === 'pr' ? formatGhPr(target, raw) : formatGhIssue(target, raw)
  } catch {
    return null
  }
}

function formatMentionedSession(data: MentionedSessionData, upToMessageId?: string): string {
  const title = data.title?.trim() || 'Untitled'
  const messages = upToMessageId ? sliceMessagesUpTo(data.messages, upToMessageId) : [...data.messages]
  const lines: string[] = [`### Session "${title}" (sessionId: ${data.sessionId})`]
  const meta: string[] = []
  if (data.harness) meta.push(`harness: ${data.harness}`)
  if (data.model) meta.push(`model: ${data.model}`)
  if (data.branch) meta.push(`branch: ${data.branch}`)
  const count = upToMessageId ? messages.length : (data.messageCount ?? messages.length)
  meta.push(`messages: ${count}`)
  if (upToMessageId) meta.push(`cutoff: upToMessageId=${upToMessageId}`)
  const lastActive = formatIso(data.lastActiveAt ?? data.createdAt)
  if (lastActive) meta.push(`lastActive: ${lastActive}`)
  if (data.tags && data.tags.length > 0) meta.push(`tags: ${data.tags.join(', ')}`)
  lines.push(meta.join(' · '))

  const page = pageTextBlocks(messages, { view: 'text', limit: MAX_SESSION_TEXT_BLOCKS })
  const formatted = formatTextBlocks(page.items, { withToolCount: true })
  if (formatted) {
    const clipped = truncateTail(formatted, MAX_SESSION_TRANSCRIPT_CHARS)
    const truncated = page.hasMore || clipped.length < formatted.length
    lines.push(
      '',
      page.hasMore
        ? `Recent transcript (${page.items.length} of ${page.total} text blocks):`
        : `Transcript (${page.items.length} text blocks):`,
      clipped,
    )
    if (truncated) {
      lines.push(
        '',
        upToMessageId
          ? `Use session_read({ sessionId: "${data.sessionId}", messageId: "${upToMessageId}", view: "text" | "user" | "assistant" | "tools" }) for earlier messages or tool details before the cutoff (do not read past "${upToMessageId}").`
          : `Use session_read({ sessionId: "${data.sessionId}", view: "text" | "user" | "assistant" | "tools" }) for earlier messages or tool details.`,
      )
    }
  } else {
    lines.push('', '_(no text messages)_')
  }
  return lines.join('\n')
}

export async function enrichMentionContext(text: string, deps: MentionContextDeps): Promise<string> {
  if (!hasMentionContextTargets(text)) return text

  const ghTargets = deps.gh ? extractGitHubMentionTargets(text) : []
  const sessionTargets = deps.readSession ? extractSessionMentionTargets(text, deps.skipSessionId) : []
  if (ghTargets.length === 0 && sessionTargets.length === 0) return text

  const [ghResults, sessionResults] = await Promise.all([
    Promise.all(ghTargets.map((target) => resolveGitHubItem(target, deps.gh!))),
    Promise.all(
      sessionTargets.map(async (target) => {
        try {
          const data = await deps.readSession!(target.sessionId)
          return data ? formatMentionedSession(data, target.upToMessageId) : null
        } catch {
          return null
        }
      }),
    ),
  ])

  const sections: string[] = []
  const ghBlocks = ghResults.filter((block): block is string => Boolean(block))
  if (ghBlocks.length > 0) {
    sections.push(
      `<superone-github-context>\nPre-fetched GitHub context for mentioned item(s):\n\n${ghBlocks.join('\n\n')}\n</superone-github-context>`,
    )
  }
  const sessionBlocks = sessionResults.filter((block): block is string => Boolean(block))
  if (sessionBlocks.length > 0) {
    const hasReminder = text.includes('<superone-session-reminder>')
    const header = hasReminder
      ? 'Pre-fetched context for mentioned SuperOne session(s):'
      : 'Pre-fetched context for mentioned SuperOne session(s). Use session_read({ sessionId, view }) for more or session_collab_request({ launches: [{ mode: "link", sessionId, summary }] }) to collaborate:'
    sections.push(
      `<superone-session-context>\n${header}\n\n${sessionBlocks.join('\n\n')}\n</superone-session-context>`,
    )
  }

  if (sections.length === 0) return text
  return `${text}\n\n${sections.join('\n\n')}`
}
