/**
 * Chat tool UI for SuperOne session archive MCP tools:
 * project_list / session_list / session_search / session_read / session_cleanup
 *
 * Label casing mirrors agent collab (`SessionCollabToolBlock` + `chat.toolBlock.collab`):
 * - Streaming: sentence case, often with …
 * - Done primary actions: Title Case noun + past participle (EN) / 名词+已+动词 (ZH)
 * - Count / empty / secondary summary: sentence-style fragments in muted summary slot
 *
 * Wired from ToolBlock for mcp__superone__{project_list,session_*}.
 */

import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  EyeOff,
  Eye,
  Folder,
  History,
  List,
  MessageSquare,
  Search,
  Trash2,
  FileText,
  Wrench,
} from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { ExpandableToolRow } from './tool-row'
import { decode as toonDecode } from '@toon-format/toon'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { resolveProjectPathForOpen } from '@/lib/resolve-project-path'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'

export type SessionArchiveToolName =
  | 'project_list'
  | 'session_list'
  | 'session_search'
  | 'session_read'
  | 'session_cleanup'

export interface SessionArchiveToolBlockProps {
  toolName: SessionArchiveToolName
  params: Record<string, unknown>
  result?: string | null
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  /** false when nested under a subagent card — header-only. */
  allowExpand?: boolean
}

// --- Parsing helpers ---

function tryParseJson(text: string | null | undefined): unknown {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function tryParseToon(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return toonDecode(text)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function shortId(id: string, n = 8): string {
  return id.length <= n ? id : `${id.slice(0, n)}…`
}

function relativeish(iso: string): string {
  if (!iso) return ''
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}

/** Compact size for list rows (character-length ranking metric, not disk bytes). */
function formatSizeChars(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/**
 * Local calendar display for session list:
 * - same year → `MM-DD HH:mm`
 * - other year → date only `YYYY-MM-DD` (no clock time)
 */
function formatMinute(iso: string, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    // Fallback for non-ISO strings
    const m = iso.match(/^(\d{4})-(\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
    if (!m) return relativeish(iso)
    const year = Number(m[1])
    if (year === now.getFullYear()) {
      return m[3] ? `${m[2]} ${m[3]}` : m[2]!
    }
    return `${m[1]}-${m[2]}`
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (y === now.getFullYear()) {
    return `${md} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${y}-${md}`
}

function HarnessGlyph({
  harness,
  acpAgentId,
}: {
  harness: string
  acpAgentId?: string | null
}) {
  const Icon = resolveSessionIcon(harness || null, acpAgentId)
  if (!Icon) {
    return <MessageSquare className="size-3 shrink-0 text-muted-foreground" aria-hidden />
  }
  return (
    <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground" title={harness || undefined}>
      <Icon status="default" size={12} renderLevel="compact" />
    </span>
  )
}

function quote(s: string, max = 40): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const clipped = t.length > max ? `${t.slice(0, max)}…` : t
  return `“${clipped}”`
}

function extractMarkdownMeta(body: string): { title?: string; pageHint?: string } {
  const titleMatch = body.match(/^title:\s*([^·\n]+)/m)
  const pageMatch = body.match(/^page:\s*([^\n]+)/m)
  return {
    title: titleMatch?.[1]?.trim(),
    pageHint: pageMatch?.[1]?.trim(),
  }
}

// --- Base template (same chrome grammar as collab) ---



function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 break-words text-foreground',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function PreBody({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2 font-mono text-xs leading-relaxed text-foreground">
      {text}
    </pre>
  )
}

// --- Expand bodies ---

/** Open a project folder (project_list row). Path is on the payload — this is the discovery tool. */
function openArchiveProject(projectPath: string) {
  if (!projectPath.trim()) return
  void useAppStore.getState().selectProject(projectPath.trim())
}

/**
 * Open a listed session: resolve projectId → path in the host, then mosaic /
 * switchToSession. Agent payloads only carry projectId (not path).
 */
function openArchiveSession(sessionId: string, projectId?: string | null) {
  if (!sessionId) return
  void (async () => {
    const target = await resolveProjectPathForOpen(projectId, useChatStore.getState().activeProject)
    if (!target) return
    if (useMosaicStore.getState().focusOrReplaceFocused(target, sessionId)) return
    await useChatStore.getState().switchToSession(target, sessionId)
  })()
}

function SessionTitleLink({
  sessionId,
  projectId,
  title,
  openLabel,
  className,
  children,
}: {
  sessionId?: string
  projectId?: string | null
  title: string
  openLabel: string
  className?: string
  children?: ReactNode
}) {
  if (!sessionId) {
    return <span className={className}>{children ?? title}</span>
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openArchiveSession(sessionId, projectId)
      }}
      className={cn(
        'min-w-0 cursor-pointer truncate text-left font-medium text-foreground hover:underline',
        className,
      )}
      title={openLabel}
    >
      {children ?? title}
    </button>
  )
}

function ProjectListBody({
  projects,
  emptyLabel,
  thisProjectLabel,
  missingLabel,
  openProjectLabel,
}: {
  projects: Array<Record<string, unknown>>
  emptyLabel: string
  thisProjectLabel: string
  missingLabel: string
  openProjectLabel: string
}) {
  if (projects.length === 0) {
    return <div className="text-muted-foreground">{emptyLabel}</div>
  }
  return (
    <div className="space-y-0.5">
      {projects.map((p, i) => {
        const id = String(p.id ?? '')
        const name = String(p.name ?? 'Untitled')
        const path = typeof p.path === 'string' ? p.path : ''
        const isCurrent = p.isCurrent === true
        const missing = p.missing === true
        const lastRaw =
          typeof p.lastActiveAt === 'string'
            ? p.lastActiveAt
            : typeof p.last_active_at === 'string'
              ? p.last_active_at
              : ''
        const last = lastRaw ? formatMinute(lastRaw) : ''
        return (
          <div
            key={id || i}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded px-1 py-0.5',
              isCurrent && 'bg-primary/5',
            )}
            title={id || undefined}
          >
            <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {path ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openArchiveProject(path)
                    }}
                    className="min-w-0 cursor-pointer truncate text-left text-xs font-medium text-foreground hover:underline"
                    title={openProjectLabel}
                  >
                    {name}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-xs font-medium text-foreground">{name}</span>
                )}
                {isCurrent ? (
                  <span className="shrink-0 text-xs text-muted-foreground">· {thisProjectLabel}</span>
                ) : null}
                {missing ? (
                  <span className="shrink-0 text-xs text-warning">· {missingLabel}</span>
                ) : null}
              </span>
              {path ? (
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={path}>
                  {path}
                </span>
              ) : null}
            </span>
            {last ? (
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground" title={lastRaw}>
                {last}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ListBody({
  sessions,
  emptyLabel,
  pinnedLabel,
  thisChatLabel,
  openSessionLabel,
}: {
  sessions: Array<Record<string, unknown>>
  emptyLabel: string
  pinnedLabel: string
  thisChatLabel: string
  openSessionLabel: string
}) {
  if (sessions.length === 0) {
    return <div className="text-muted-foreground">{emptyLabel}</div>
  }
  return (
    <div className="space-y-0.5">
      {sessions.map((s, i) => {
        const id = String(s.id ?? s.sessionId ?? '')
        const title = String(s.title ?? 'Untitled')
        const harness = String(s.harness ?? '')
        const acpAgentId =
          typeof s.acpAgentId === 'string'
            ? s.acpAgentId
            : typeof s.acp_agent_id === 'string'
              ? s.acp_agent_id
              : null
        const count = typeof s.messageCount === 'number' ? s.messageCount : null
        const sizeBytes = typeof s.sizeBytes === 'number' ? s.sizeBytes : null
        const sizeLabel = sizeBytes != null ? formatSizeChars(sizeBytes) : ''
        // Prefer createdAt; fall back to lastActiveAt for older payloads
        const createdRaw =
          typeof s.createdAt === 'string'
            ? s.createdAt
            : typeof s.created_at === 'string'
              ? s.created_at
              : typeof s.lastActiveAt === 'string'
                ? s.lastActiveAt
                : ''
        const created = createdRaw ? formatMinute(createdRaw) : ''
        const pinned = s.pinned === true || s.isPinned === true
        const self = s.isSelf === true
        const rowProjectId =
          typeof s.projectId === 'string'
            ? s.projectId
            : typeof s.project_id === 'string'
              ? s.project_id
              : null
        return (
          <div
            key={id || i}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded px-1 py-0.5',
              self && 'bg-primary/5',
            )}
            title={id || undefined}
          >
            <HarnessGlyph harness={harness} acpAgentId={acpAgentId} />
            {/* Left cluster: title link (truncates) then msg count; time stays far right */}
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <SessionTitleLink
                sessionId={id || undefined}
                projectId={rowProjectId}
                title={title}
                openLabel={openSessionLabel}
                className="min-w-0 flex-1"
              >
                {title}
                {pinned ? (
                  <span className="ml-1 font-normal text-muted-foreground no-underline">· {pinnedLabel}</span>
                ) : null}
                {self ? (
                  <span className="ml-1 font-normal text-muted-foreground no-underline">· {thisChatLabel}</span>
                ) : null}
              </SessionTitleLink>
              {count != null ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 tabular-nums text-muted-foreground"
                  title={`${count} messages`}
                >
                  <MessageSquare className="size-3 opacity-70" aria-hidden />
                  {count}
                </span>
              ) : null}
              {sizeLabel ? (
                <span
                  className="shrink-0 tabular-nums text-muted-foreground"
                  title={`Approx transcript size (char length): ${sizeBytes}`}
                >
                  {sizeLabel}
                </span>
              ) : null}
            </span>
            {created ? (
              <span className="shrink-0 tabular-nums text-muted-foreground" title={createdRaw}>
                {created}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SearchBody({
  hits,
  emptyLabel,
  openSessionLabel,
}: {
  hits: Array<Record<string, unknown>>
  emptyLabel: string
  openSessionLabel: string
}) {
  if (hits.length === 0) {
    return <div className="text-muted-foreground">{emptyLabel}</div>
  }
  return (
    <div className="space-y-2">
      {hits.map((h, i) => {
        const title = String(h.title ?? 'Untitled')
        const snippet = String(h.snippet ?? '')
        const role = String(h.role ?? '')
        const harness = String(h.harness ?? '')
        const sid = String(h.sessionId ?? '')
        const mid = String(h.messageId ?? '')
        const hitProjectId =
          typeof h.projectId === 'string'
            ? h.projectId
            : typeof h.project_id === 'string'
              ? h.project_id
              : null
        return (
          <div
            key={`${sid}-${mid}-${i}`}
            className={cn('space-y-0.5', i > 0 && 'border-t border-border/30 pt-2')}
            title={sid ? `session ${sid}` : undefined}
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <SessionTitleLink
                sessionId={sid || undefined}
                projectId={hitProjectId}
                title={title}
                openLabel={openSessionLabel}
                className="min-w-0 flex-1"
              />
              {role ? <span className="shrink-0 text-muted-foreground">{role}</span> : null}
              {harness ? <span className="shrink-0 text-muted-foreground">{harness}</span> : null}
            </div>
            {snippet ? (
              <div className="line-clamp-2 text-muted-foreground">{snippet}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** Normalize cleanup session refs: modern `{ id, title }` or legacy bare id strings. */
function normalizeSessionRefs(value: unknown): Array<{ id: string; title: string }> {
  return asArray(value).flatMap((item) => {
    if (typeof item === 'string' && item.length > 0) {
      return [{ id: item, title: shortId(item, 12) }]
    }
    const rec = asRecord(item)
    if (!rec || typeof rec.id !== 'string' || !rec.id) return []
    const title =
      typeof rec.title === 'string' && rec.title.trim()
        ? rec.title.trim()
        : shortId(rec.id, 12)
    return [{ id: rec.id, title }]
  })
}

function CleanupBody({
  candidates,
  skippedPinned,
  deleted,
  failed,
  affected,
  labels,
}: {
  candidates?: Array<Record<string, unknown>>
  skippedPinned?: Array<Record<string, unknown>>
  deleted?: Array<{ id: string; title: string }>
  failed?: Array<{ id: string; title: string }>
  affected?: Array<{ id: string; title: string }>
  labels: {
    deleted: string
    failed: string
    affected: string
    candidates: string
    wereCandidates: string
    skippedPinned: string
  }
}) {
  const rows = candidates ?? []
  const actedOn = deleted && deleted.length > 0 ? deleted : affected
  const actedLabel = deleted && deleted.length > 0 ? labels.deleted : labels.affected
  return (
    <div className="space-y-2">
      {actedOn && actedOn.length > 0 ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">{actedLabel}</div>
          {actedOn.map((s) => (
            <div key={s.id} className="flex min-w-0 items-baseline gap-2">
              {/* Prefer full title; id yields first when space is tight */}
              <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={s.title}>
                {s.title}
              </span>
              <span
                className="min-w-0 max-w-[45%] shrink truncate text-right font-mono text-xs text-muted-foreground"
                title={s.id}
              >
                {s.id}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {failed && failed.length > 0 ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">{labels.failed}</div>
          {failed.map((s) => (
            <div key={s.id} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={s.title}>
                {s.title}
              </span>
              <span
                className="min-w-0 max-w-[45%] shrink truncate text-right font-mono text-xs text-muted-foreground"
                title={s.id}
              >
                {s.id}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">
            {actedOn || (failed && failed.length > 0) ? labels.wereCandidates : labels.candidates}
          </div>
          {rows.map((c, i) => (
            <div key={String(c.id ?? i)} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {String(c.title ?? 'Untitled')}
              </span>
              {typeof c.messageCount === 'number' ? (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.messageCount}
                </span>
              ) : null}
              {typeof c.lastActiveAt === 'string' ? (
                <span className="shrink-0 text-muted-foreground">
                  {relativeish(c.lastActiveAt)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {skippedPinned && skippedPinned.length > 0 ? (
        <div className="space-y-1">
          <div className="text-muted-foreground">{labels.skippedPinned}</div>
          {skippedPinned.map((c, i) => (
            <div key={String(c.id ?? i)} className="truncate text-muted-foreground">
              {String(c.title ?? (typeof c.id === 'string' ? shortId(c.id, 12) : 'Untitled'))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// --- Main ---

export function SessionArchiveToolBlock({
  toolName,
  params,
  result,
  isStreaming = false,
  isError = false,
  isDenied = false,
  allowExpand = true,
}: SessionArchiveToolBlockProps) {
  const { t } = useTranslation()
  const a = 'chat.toolBlock.archive' as const

  const parsed = useMemo(() => {
    const json = tryParseJson(result)
    if (json != null) return json
    return tryParseToon(result)
  }, [result])

  const rec = asRecord(parsed)
  // cancelled = user closed the confirm without deleting — neutral chrome (not warning/error)
  // partial = some deletes succeeded — warning chrome
  const tone: 'default' | 'error' | 'warning' | 'denied' = isDenied || rec?.status === 'rejected'
    ? 'denied'
    : isError || rec?.status === 'error'
      ? 'error'
      : rec?.status === 'partial'
        ? 'warning'
        : 'default'

  const canShowExpand = allowExpand && !isStreaming && !isDenied

  // ---------- project_list ----------
  if (toolName === 'project_list') {
    const projects = asArray(rec?.projects).map((p) => asRecord(p) ?? {})
    const count = typeof rec?.count === 'number' ? rec.count : projects.length
    const query = typeof params.query === 'string' ? params.query : ''
    const filterSummary = query ? quote(query) : ''

    let label = t(`${a}.projectsListed`)
    if (isStreaming) label = t(`${a}.listingProjects`)
    else if (isDenied || isError || rec?.status === 'error') label = t(`${a}.listProjects`)

    const errMsg = typeof rec?.message === 'string' ? rec.message : ''
    const summary = isStreaming
      ? filterSummary || undefined
      : isError || rec?.status === 'error'
        ? errMsg || filterSummary || undefined
        : [t(`${a}.projectCount`, { count }), filterSummary].filter(Boolean).join(' · ')

    const expandable = canShowExpand && !isError && projects.length > 0

    return (
      <ExpandableToolRow
        icon={<Folder className="size-3 shrink-0 text-muted-foreground" />}
        label={label}
        summary={summary}
        streaming={isStreaming}
        tone={tone}
        expandable={expandable}
      >
        <ProjectListBody
          projects={projects}
          emptyLabel={t(`${a}.emptyProjects`)}
          thisProjectLabel={t(`${a}.thisProject`)}
          missingLabel={t(`${a}.missingProject`)}
          openProjectLabel={t(`${a}.openProject`)}
        />
      </ExpandableToolRow>
    )
  }

  // ---------- session_list ----------
  if (toolName === 'session_list') {
    const sessions = asArray(rec?.sessions).map((s) => asRecord(s) ?? {})
    const count = typeof rec?.count === 'number' ? rec.count : sessions.length
    const query = typeof params.query === 'string' ? params.query : ''
    const harness = typeof params.harness === 'string' ? params.harness : ''
    const filterSummary = [query ? quote(query) : '', harness].filter(Boolean).join(' · ')

    let label = t(`${a}.sessionsListed`)
    if (isStreaming) label = t(`${a}.listingSessions`)
    else if (isDenied || isError || rec?.status === 'error') label = t(`${a}.listSessions`)

    const errMsg = typeof rec?.message === 'string' ? rec.message : ''
    const summary = isStreaming
      ? filterSummary || undefined
      : isError || rec?.status === 'error'
        ? errMsg || filterSummary || undefined
        : [
            t(`${a}.sessionCount`, { count }),
            filterSummary,
          ]
            .filter(Boolean)
            .join(' · ')

    const expandable = canShowExpand && !isError && sessions.length > 0

    return (
      <ExpandableToolRow
        icon={<List className="size-3 shrink-0 text-muted-foreground" />}
        label={label}
        summary={summary}
        streaming={isStreaming}
        tone={tone}
        expandable={expandable}
      >
        <ListBody
          sessions={sessions}
          emptyLabel={t(`${a}.emptySessions`)}
          pinnedLabel={t(`${a}.pinned`)}
          thisChatLabel={t(`${a}.thisChat`)}
          openSessionLabel={t(`${a}.openSession`)}
        />
      </ExpandableToolRow>
    )
  }

  // ---------- session_search ----------
  if (toolName === 'session_search') {
    const hits = asArray(rec?.hits).map((h) => asRecord(h) ?? {})
    const count = typeof rec?.count === 'number' ? rec.count : hits.length
    const query = typeof params.query === 'string' ? params.query : String(rec?.query ?? '')
    const q = query ? quote(query) : ''

    // Done: Title-ish count label (collab "Received N messages"); streaming sentence case + …
    let label =
      count === 0 ? t(`${a}.noHits`) : t(`${a}.hitsFound`, { count })
    if (isStreaming) label = t(`${a}.searchingSessions`)
    else if (isDenied || isError || rec?.status === 'error') label = t(`${a}.searchSessions`)

    const errMsg = typeof rec?.message === 'string' ? rec.message : ''
    const summary = isStreaming
      ? q || undefined
      : isError || rec?.status === 'error'
        ? errMsg || q || undefined
        : q || undefined

    const expandable = canShowExpand && !isError && hits.length > 0

    return (
      <ExpandableToolRow
        icon={<Search className="size-3 shrink-0 text-muted-foreground" />}
        label={label}
        summary={summary}
        streaming={isStreaming}
        tone={tone}
        expandable={expandable}
      >
        <SearchBody
          hits={hits}
          emptyLabel={t(`${a}.emptyHits`)}
          openSessionLabel={t(`${a}.openSession`)}
        />
      </ExpandableToolRow>
    )
  }

  // ---------- session_read ----------
  if (toolName === 'session_read') {
    const view =
      typeof params.view === 'string'
        ? params.view
        : typeof rec?.view === 'string'
          ? rec.view
          : 'text'
    const sessionId =
      typeof params.sessionId === 'string' ? params.sessionId : String(rec?.sessionId ?? '')
    const titleFromMeta = typeof rec?.title === 'string' ? rec.title : ''
    const isMetaJson = view === 'meta' && rec != null && rec.status !== 'error'
    const isToolDetail = view === 'tool_detail'
    const markdownBody =
      !isMetaJson && !isToolDetail && typeof result === 'string' && !tryParseJson(result)
        ? result
        : !isMetaJson && !isToolDetail && typeof result === 'string' && rec == null
          ? result
          : null
    const mdMeta = markdownBody ? extractMarkdownMeta(markdownBody) : {}
    const sessionTitle = titleFromMeta || mdMeta.title || ''

    let Icon = FileText
    let label = isStreaming ? t(`${a}.readingConversation`) : t(`${a}.conversation`)
    if (view === 'meta') {
      Icon = History
      label = isStreaming ? t(`${a}.readingSessionMeta`) : t(`${a}.sessionMeta`)
    } else if (view === 'user') {
      label = isStreaming ? t(`${a}.readingUserMessages`) : t(`${a}.userMessages`)
    } else if (view === 'assistant') {
      label = isStreaming ? t(`${a}.readingAssistantMessages`) : t(`${a}.assistantMessages`)
    } else if (view === 'tools') {
      Icon = Wrench
      label = isStreaming ? t(`${a}.readingToolIndex`) : t(`${a}.toolIndex`)
    } else if (view === 'tool_detail') {
      Icon = Wrench
      label = isStreaming ? t(`${a}.readingToolDetail`) : t(`${a}.toolDetail`)
    }
    if (isDenied || isError || rec?.status === 'error') {
      if (view === 'meta') label = t(`${a}.readSessionMeta`)
      else if (view === 'user') label = t(`${a}.readUserMessages`)
      else if (view === 'assistant') label = t(`${a}.readAssistantMessages`)
      else if (view === 'tools') label = t(`${a}.readToolIndex`)
      else if (view === 'tool_detail') label = t(`${a}.readToolDetail`)
      else label = t(`${a}.readConversation`)
    }

    const summaryBits: string[] = []
    if (isError || rec?.status === 'error') {
      if (typeof rec?.message === 'string') summaryBits.push(rec.message)
    } else {
      if (sessionTitle) summaryBits.push(sessionTitle)
      else if (isStreaming && sessionId) summaryBits.push(shortId(sessionId, 8))
      if (view === 'tool_detail' && rec?.tool && typeof rec.tool === 'object') {
        const toolNameStr = String((rec.tool as Record<string, unknown>).toolName ?? '')
        if (toolNameStr) summaryBits.push(toolNameStr)
      }
    }

    const expandable =
      canShowExpand
      && !isError
      && (isMetaJson
        || isToolDetail
        || (!!markdownBody && markdownBody.length > 0))

    return (
      <ExpandableToolRow
        icon={<Icon className="size-3 shrink-0 text-muted-foreground" />}
        label={label}
        summary={summaryBits.filter(Boolean).join(' · ') || undefined}
        streaming={isStreaming}
        tone={tone}
        expandable={expandable}
      >
        {isMetaJson ? (
          <div className="space-y-1">
            {typeof rec.title === 'string' ? (
              <FieldRow label={t(`${a}.fields.title`)} value={rec.title} />
            ) : null}
            {typeof rec.harness === 'string' ? (
              <FieldRow label={t(`${a}.fields.harness`)} value={rec.harness} />
            ) : null}
            {typeof rec.messageCount === 'number' ? (
              <FieldRow label={t(`${a}.fields.messages`)} value={String(rec.messageCount)} />
            ) : null}
            {typeof rec.lastActiveAt === 'string' ? (
              <FieldRow label={t(`${a}.fields.active`)} value={relativeish(rec.lastActiveAt)} />
            ) : null}
            {typeof rec.model === 'string' && rec.model ? (
              <FieldRow label={t(`${a}.fields.model`)} value={rec.model} />
            ) : null}
            {typeof rec.branch === 'string' && rec.branch ? (
              <FieldRow label={t(`${a}.fields.branch`)} value={rec.branch} mono />
            ) : null}
            {typeof rec.sessionId === 'string' ? (
              <FieldRow label={t(`${a}.fields.sessionId`)} value={rec.sessionId} mono />
            ) : null}
          </div>
        ) : isToolDetail && rec?.tool && typeof rec.tool === 'object' ? (
          <div className="space-y-1">
            {(() => {
              const tool = rec.tool as Record<string, unknown>
              return (
                <>
                  {typeof tool.toolName === 'string' ? (
                    <FieldRow label={t(`${a}.fields.tool`)} value={tool.toolName} />
                  ) : null}
                  {typeof tool.toolUseId === 'string' ? (
                    <FieldRow label={t(`${a}.fields.id`)} value={tool.toolUseId} mono />
                  ) : null}
                  {typeof tool.input === 'string' ? (
                    <div className="space-y-1">
                      <div className="text-muted-foreground">{t(`${a}.fields.input`)}</div>
                      <PreBody text={tool.input} />
                    </div>
                  ) : null}
                  {typeof tool.resultSummary === 'string' ? (
                    <div className="space-y-1">
                      <div className="text-muted-foreground">{t(`${a}.fields.result`)}</div>
                      <PreBody text={tool.resultSummary} />
                    </div>
                  ) : null}
                </>
              )
            })()}
          </div>
        ) : markdownBody ? (
          <div className="space-y-2">
            {mdMeta.pageHint ? (
              <div className="text-muted-foreground">
                {t(`${a}.pageHint`, { hint: mdMeta.pageHint })}
              </div>
            ) : null}
            <PreBody text={markdownBody} />
          </div>
        ) : null}
      </ExpandableToolRow>
    )
  }

  // ---------- session_cleanup ----------
  // Discover via session_list; cleanup only hide/unhide/delete (legacy "preview" may still appear in old transcripts).
  const action =
    typeof params.action === 'string' ? params.action : String(rec?.action ?? 'hide')
  const candidates = asArray(rec?.candidates).map((c) => asRecord(c) ?? {})
  const skippedPinned = asArray(rec?.skippedPinned).map((c) =>
    typeof c === 'string' ? { id: c, title: c } : (asRecord(c) ?? {}),
  )
  const deleted = normalizeSessionRefs(rec?.deleted)
  const failed = normalizeSessionRefs(rec?.failed)
  const affected = normalizeSessionRefs(rec?.affected)
  const status = typeof rec?.status === 'string' ? rec.status : ''
  const idCount = Array.isArray(params.sessionIds) ? params.sessionIds.length : 0

  let Icon: typeof Archive | typeof Trash2 | typeof EyeOff | typeof Eye = Archive
  let label = t(`${a}.sessionsHidden`)
  let summary: string | undefined

  if (isDenied) {
    if (action === 'delete') {
      Icon = Trash2
      label = t(`${a}.deleteSessions`)
    } else if (action === 'unhide') {
      Icon = Eye
      label = t(`${a}.unhideSessions`)
    } else {
      Icon = EyeOff
      label = t(`${a}.hideSessions`)
    }
    if (idCount > 0) summary = t(`${a}.sessionCount`, { count: idCount })
  } else if (isStreaming) {
    if (action === 'delete') {
      Icon = Trash2
      label = t(`${a}.confirmingDelete`)
      if (idCount > 0) summary = t(`${a}.sessionCount`, { count: idCount })
    } else if (action === 'unhide') {
      Icon = Eye
      label = t(`${a}.unhidingSessions`)
      if (idCount > 0) summary = t(`${a}.sessionCount`, { count: idCount })
    } else if (action === 'preview') {
      // Legacy transcripts only
      label = t(`${a}.previewingCleanup`)
    } else {
      Icon = EyeOff
      label = t(`${a}.hidingSessions`)
      if (idCount > 0) summary = t(`${a}.sessionCount`, { count: idCount })
    }
  } else if (isError || status === 'error') {
    if (action === 'delete') {
      Icon = Trash2
      label = t(`${a}.deleteSessions`)
    } else if (action === 'unhide') {
      Icon = Eye
      label = t(`${a}.unhideSessions`)
    } else {
      Icon = EyeOff
      label = t(`${a}.hideSessions`)
    }
    summary = typeof rec?.message === 'string'
      ? rec.message
      : failed.length > 0
        ? t(`${a}.sessionCount`, { count: failed.length })
        : undefined
  } else if (status === 'cancelled' || status === 'rejected') {
    Icon = Trash2
    label = t(`${a}.deleteSessions`)
  } else if (status === 'partial' && action === 'delete') {
    Icon = Trash2
    label = t(`${a}.sessionsDeletedPartial`)
    summary = t(`${a}.partialDeleteSummary`, {
      deleted: deleted.length,
      failed: failed.length,
    })
  } else if (action === 'preview') {
    // Legacy transcripts
    Icon = Archive
    label = t(`${a}.cleanupPreview`)
    summary = t(`${a}.candidateCount`, { count: candidates.length })
  } else if (action === 'hide') {
    Icon = EyeOff
    label = t(`${a}.sessionsHidden`)
    summary = t(`${a}.sessionCount`, { count: affected.length || candidates.length || idCount })
  } else if (action === 'unhide') {
    Icon = Eye
    label = t(`${a}.sessionsUnhidden`)
    summary = t(`${a}.sessionCount`, { count: affected.length || candidates.length || idCount })
  } else if (action === 'delete') {
    Icon = Trash2
    label = t(`${a}.sessionsDeleted`)
    summary = t(`${a}.sessionCount`, { count: deleted.length || idCount })
  }

  const expandable =
    canShowExpand
    && !isError
    && (candidates.length > 0
      || deleted.length > 0
      || failed.length > 0
      || skippedPinned.length > 0
      || affected.length > 0)

  return (
    <ExpandableToolRow
      icon={<Icon className="size-3 shrink-0 text-muted-foreground" />}
      label={label}
      summary={summary}
      streaming={isStreaming}
      tone={tone}
      expandable={expandable}
    >
      <CleanupBody
        candidates={candidates.length > 0 ? candidates : undefined}
        skippedPinned={skippedPinned.length > 0 ? skippedPinned : undefined}
        deleted={deleted.length > 0 ? deleted : undefined}
        failed={failed.length > 0 ? failed : undefined}
        affected={affected.length > 0 ? affected : undefined}
        labels={{
          deleted: t(`${a}.deletedSection`),
          failed: t(`${a}.failedSection`),
          affected: t(`${a}.affectedSection`),
          candidates: t(`${a}.candidatesSection`),
          wereCandidates: t(`${a}.wereCandidatesSection`),
          skippedPinned: t(`${a}.skippedPinnedSection`),
        }}
      />
    </ExpandableToolRow>
  )
}

export function isSessionArchiveToolName(name: string): name is SessionArchiveToolName {
  return (
    name === 'project_list'
    || name === 'session_list'
    || name === 'session_search'
    || name === 'session_read'
    || name === 'session_cleanup'
  )
}
