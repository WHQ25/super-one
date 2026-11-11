export type ManageSubagentsAction = 'list' | 'list_peers' | 'kill' | 'kill_all' | 'unknown'

export type ListedSubagentState = 'running' | 'waiting' | 'idle' | 'canceling' | 'errored' | 'unknown'

export interface ListedSubagent {
  conversationId: string
  shortId: string
  role: string
  type?: string
  state: ListedSubagentState
  rawState: string
  stateDetail?: string
  transcriptPath?: string
}

export interface ManageSubagentsInfo {
  action: ManageSubagentsAction
  conversationIds: string[]
  shortConversationIds: string[]
  parentConversationId?: string
  shortParentId?: string
  declaredCount?: number
  subagents: ListedSubagent[]
  emptyList: boolean
  killedCount?: number
  killedRoles: string[]
  noActiveToKill: boolean
  errorMessage?: string
  extraText?: string
  hasPlaceholderResult: boolean
  raw: string
}

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const STEP_ERROR_PREFIX_RE = /^Encountered error in step execution:\s*/i
const ACTIVE_LIST_RE = /^You have\s+(\d+)\s+active\s+(peer\s+)?subagent\(s\)(?:\s*\(parent\s+([^)]+)\))?:\s*(?:\r?\n([\s\S]*))?$/i
const KILLED_SUMMARY_RE = /^Successfully killed\s+(\d+)\s+subagent\(s\)(?:\s+and their descendants)?\.?(?:\r?\nKilled roles:\s*([^\r\n]+))?\s*$/i
const NO_ACTIVE_TO_KILL_RE = /^No active subagents to kill\.?$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function shortenConversationId(conversationId: string | undefined | null): string | undefined {
  if (typeof conversationId !== 'string') return undefined
  const trimmed = conversationId.trim()
  if (!trimmed) return undefined
  if (UUID_RE.test(trimmed)) return trimmed.slice(0, 8)
  if (trimmed.length > 16) return `${trimmed.slice(0, 12)}…`
  return trimmed
}

function parseAction(raw: unknown): ManageSubagentsAction {
  if (typeof raw !== 'string') return 'unknown'
  const normalized = raw.trim().toLowerCase()
  if (
    normalized === 'list' ||
    normalized === 'list_peers' ||
    normalized === 'kill' ||
    normalized === 'kill_all'
  ) {
    return normalized
  }
  return 'unknown'
}

function mapSubagentState(raw: string): ListedSubagentState {
  const key = raw.trim().toLowerCase()
  if (key === 'running' || key === 'in_progress' || key === 'active') return 'running'
  if (
    key === 'waiting' ||
    key === 'waiting_for_input' ||
    key === 'waiting_for_dependents' ||
    key === 'waiting_for_message' ||
    key === 'pending'
  ) {
    return 'waiting'
  }
  if (key === 'idle') return 'idle'
  if (key === 'canceling' || key === 'cancelling' || key === 'stopping') return 'canceling'
  if (key === 'errored' || key === 'error' || key === 'failed') return 'errored'
  return 'unknown'
}

function stripFileUri(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return trimmed
  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  } catch {
    return trimmed.replace(/^file:\/\//i, '')
  }
}

function extractConversationIds(params: Record<string, unknown>): string[] {
  const raw = params.conversationIds ?? params.ConversationIds ?? params.conversation_ids
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
        }
      } catch {
        return []
      }
    }
  }
  return []
}

function parseSubagentEntry(entry: unknown): ListedSubagent | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const obj = entry as Record<string, unknown>
  const conversationId =
    typeof obj.conversationId === 'string'
      ? obj.conversationId.trim()
      : typeof obj.conversation_id === 'string'
        ? obj.conversation_id.trim()
        : ''
  const rawRole = typeof obj.role === 'string' ? obj.role.trim() : ''
  const rawType = typeof obj.type === 'string' ? obj.type.trim() : ''
  const role = rawRole || rawType
  if (!conversationId && !role) return null
  const rawState = typeof obj.state === 'string' ? obj.state.trim() : 'unspecified'
  const stateDetail =
    typeof obj.stateDetail === 'string' && obj.stateDetail.trim().length > 0
      ? obj.stateDetail.trim()
      : typeof obj.state_detail === 'string' && obj.state_detail.trim().length > 0
        ? obj.state_detail.trim()
        : undefined
  const transcriptRaw = typeof obj.transcript === 'string' ? obj.transcript.trim() : ''
  return {
    conversationId,
    shortId: shortenConversationId(conversationId) ?? conversationId,
    role: role || shortenConversationId(conversationId) || conversationId,
    ...(rawType ? { type: rawType } : {}),
    state: mapSubagentState(rawState),
    rawState,
    ...(stateDetail ? { stateDetail } : {}),
    ...(transcriptRaw ? { transcriptPath: stripFileUri(transcriptRaw) } : {}),
  }
}

function parseSubagentsJsonArray(rawJson: string): ListedSubagent[] | null {
  const trimmed = rawJson.trim()
  if (!trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return null
    const out: ListedSubagent[] = []
    for (const item of parsed) {
      const sub = parseSubagentEntry(item)
      if (sub) out.push(sub)
    }
    return out
  } catch {
    return null
  }
}

export function parseManageSubagents(
  params: Record<string, unknown>,
  result?: string | null,
  isError?: boolean,
): ManageSubagentsInfo {
  let action = parseAction(params.action ?? params.Action)
  const conversationIds = extractConversationIds(params)
  const shortConversationIds = conversationIds.map((id) => shortenConversationId(id) ?? id)

  const strippedResult = typeof result === 'string'
    ? result.replace(STEP_TIMESTAMP_HEADER_RE, '').trim()
    : ''
  const hasPlaceholderResult = strippedResult === 'done' || strippedResult === 'failed'
  const text = hasPlaceholderResult ? '' : strippedResult

  let declaredCount: number | undefined
  let isPeerList = false
  let parentConversationId: string | undefined
  let parsedSubagents: ListedSubagent[] | null = null

  if (!isError && text) {
    const listMatch = ACTIVE_LIST_RE.exec(text)
    if (listMatch) {
      declaredCount = Number(listMatch[1])
      isPeerList = Boolean(listMatch[2])
      parentConversationId = listMatch[3]?.trim() || undefined
      const jsonBody = listMatch[4]?.trim() ?? '[]'
      parsedSubagents = parseSubagentsJsonArray(jsonBody) ?? []
    } else if (text.startsWith('[')) {
      parsedSubagents = parseSubagentsJsonArray(text)
    }
  }

  const killedMatch = !isError && text ? KILLED_SUMMARY_RE.exec(text) : null
  const noActiveToKill = !isError && text ? NO_ACTIVE_TO_KILL_RE.test(text) : false

  const killedCount = killedMatch ? Number(killedMatch[1]) : noActiveToKill ? 0 : undefined
  const killedRoles = killedMatch?.[2]
    ? killedMatch[2]
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean)
    : []

  const emptyList =
    parsedSubagents !== null &&
    parsedSubagents.length === 0 &&
    (declaredCount === undefined || declaredCount === 0)

  if (action === 'unknown') {
    if (parsedSubagents !== null) {
      action = isPeerList ? 'list_peers' : 'list'
    } else if (killedMatch || noActiveToKill) {
      action = conversationIds.length > 0 ? 'kill' : 'kill_all'
    } else if (isError && text) {
      if (/manage_subagents\s+kill_all/i.test(text)) action = 'kill_all'
      else if (/manage_subagents\s+kill\b|failed to kill subagent|subagent\s+"[^"]+"\s+not found/i.test(text)) {
        action = 'kill'
      } else if (/manage_subagents\s+list_peers/i.test(text)) {
        action = 'list_peers'
      } else if (/manage_subagents\s+list\b/i.test(text)) {
        action = 'list'
      }
    }
  }

  const cleanedError = isError && text ? text.replace(STEP_ERROR_PREFIX_RE, '').trim() : undefined
  const isStructured =
    parsedSubagents !== null ||
    Boolean(killedMatch) ||
    noActiveToKill ||
    Boolean(cleanedError)
  const extraText = !isStructured && text ? text : undefined
  const shortParentId = shortenConversationId(parentConversationId)

  return {
    action,
    conversationIds,
    shortConversationIds,
    ...(parentConversationId ? { parentConversationId } : {}),
    ...(shortParentId ? { shortParentId } : {}),
    ...(declaredCount !== undefined && Number.isFinite(declaredCount) ? { declaredCount } : {}),
    subagents: parsedSubagents ?? [],
    emptyList,
    ...(killedCount !== undefined && Number.isFinite(killedCount) ? { killedCount } : {}),
    killedRoles,
    noActiveToKill,
    ...(cleanedError ? { errorMessage: cleanedError } : {}),
    ...(extraText ? { extraText } : {}),
    hasPlaceholderResult,
    raw: text,
  }
}

export function manageSubagentsSummaryText(params: Record<string, unknown>): string {
  const info = parseManageSubagents(params)
  if (info.shortConversationIds.length === 1) return info.shortConversationIds[0]!
  if (info.shortConversationIds.length > 1) {
    return `${info.shortConversationIds[0]} +${info.shortConversationIds.length - 1}`
  }
  if (info.action !== 'unknown') return info.action
  return ''
}
