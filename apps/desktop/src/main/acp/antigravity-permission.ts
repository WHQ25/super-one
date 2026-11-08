import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import type { PermissionMode } from '@superone/shared/agent-types'
import type { GrokAskUserQuestionParams } from './acp-xai-extensions'

const TOOL_TEXT_LIMIT = 8_000
const QUESTION_LABEL_LIMIT = 512
const WARNING_TEXT_LIMIT = 512
const SECURITY_WARNING_META_KEY = 'agy.security.warning'
const ReadOnlyKinds = new Set(['read', 'search', 'think'])
const MutationKinds = new Set(['edit', 'delete', 'move'])
const answeredQuestionsByToolCallId = new Map<string, string>()

export function consumeAntigravityAnsweredQuestionSummary(toolCallId: string | undefined | null): string | undefined {
  if (!toolCallId) return undefined
  const summary = answeredQuestionsByToolCallId.get(toolCallId)
  if (summary !== undefined) answeredQuestionsByToolCallId.delete(toolCallId)
  return summary
}

function recordAnsweredQuestionSummary(toolCallId: string | undefined | null, summary: string): void {
  if (!toolCallId || !summary) return
  if (answeredQuestionsByToolCallId.size >= 500) {
    const oldest = answeredQuestionsByToolCallId.keys().next().value
    if (oldest) answeredQuestionsByToolCallId.delete(oldest)
  }
  answeredQuestionsByToolCallId.set(toolCallId, summary)
}

function copyBoundedText(text: string): string {
  return Buffer.from(text, 'utf16le').toString('utf16le')
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val))
}

export function extractAntigravityToolNameFromTitle(title: string | undefined | null): string | undefined {
  if (typeof title !== 'string') return undefined
  const trimmed = title.trim()
  if (!trimmed || trimmed === 'Run command' || trimmed === 'Run command?' || trimmed === 'Run tool') {
    return undefined
  }
  return (
    /^Running\s+([a-zA-Z0-9_.:-]+)$/.exec(trimmed)?.[1] ??
    /^Run\s+([a-zA-Z0-9_.:-]+)\??$/.exec(trimmed)?.[1]
  )
}

export function isAntigravityUserInputRequest(request: RequestPermissionRequest): boolean {
  if (
    typeof request.toolCall?.toolCallId === 'string' &&
    request.toolCall.toolCallId.startsWith('interaction_')
  ) {
    return true
  }
  if (extractAntigravityToolNameFromTitle(request.toolCall?.title) === 'ask_question') {
    return true
  }
  const rawInput = request.toolCall?.rawInput
  return isRecord(rawInput) && Array.isArray(rawInput.questions) && rawInput.questions.length > 0
}

export function extractAntigravitySecurityWarning(options: ReadonlyArray<PermissionOption>): string | undefined {
  for (const option of options) {
    const meta = (option as { _meta?: unknown })._meta
    if (!isRecord(meta)) continue
    const rawWarning = meta[SECURITY_WARNING_META_KEY]
    if (!isRecord(rawWarning)) continue
    const message =
      (typeof rawWarning.message === 'string' && rawWarning.message.trim()) ||
      (typeof rawWarning.title === 'string' && rawWarning.title.trim()) || ''
    if (!message) continue
    return message.length > WARNING_TEXT_LIMIT ? copyBoundedText(`${message.slice(0, WARNING_TEXT_LIMIT - 3)}...`) : message
  }
  return undefined
}

function questionOptionLabel(option: PermissionOption): string {
  const label = (typeof option.name === 'string' ? option.name.trim() : '') || option.optionId
  return label.length > QUESTION_LABEL_LIMIT ? copyBoundedText(`${label.slice(0, QUESTION_LABEL_LIMIT - 3)}...`) : label
}

export function extractAntigravityUserInputQuestion(request: RequestPermissionRequest): GrokAskUserQuestionParams | null {
  if (!isAntigravityUserInputRequest(request) || request.options.length === 0) return null
  const seen = new Set<string>()
  for (const option of request.options) {
    if (!option.optionId?.trim() || seen.has(option.optionId)) return null
    seen.add(option.optionId)
  }
  const rawInput = isRecord(request.toolCall.rawInput) ? request.toolCall.rawInput : null
  const rawQuestions = rawInput && Array.isArray(rawInput.questions) ? rawInput.questions : null
  const firstRawQuestion = rawQuestions && isRecord(rawQuestions[0]) ? rawQuestions[0] : null
  const promptFromInput =
    firstRawQuestion && typeof firstRawQuestion.question === 'string' && firstRawQuestion.question.trim()
      ? firstRawQuestion.question.trim()
      : null
  const multiSelect = Boolean(firstRawQuestion?.is_multi_select || firstRawQuestion?.isMultiSelect)
  const rawTitle =
    promptFromInput ??
    (typeof request.toolCall.title === 'string' && request.toolCall.title.trim()
      ? request.toolCall.title.trim()
      : 'Choose an option.')
  const questionText = rawTitle.length > TOOL_TEXT_LIMIT ? copyBoundedText(`${rawTitle.slice(0, TOOL_TEXT_LIMIT - 3)}...`) : rawTitle
  const filteredOptions = promptFromInput
    ? request.options.filter((opt) => opt.optionId !== 'other' && opt.optionId !== 'skip')
    : request.options
  const effectiveOptions = filteredOptions.length > 0 ? filteredOptions : request.options
  return {
    toolCallId: request.toolCall.toolCallId,
    questions: [{
      id: request.toolCall.toolCallId,
      header: 'Question',
      question: questionText,
      multiSelect,
      options: effectiveOptions.map((option) => {
        const label = questionOptionLabel(option)
        return { label, description: label }
      }),
    }],
  }
}

export function makeAntigravityUserInputResponse(request: RequestPermissionRequest, response: Record<string, unknown>): RequestPermissionResponse {
  if (response.outcome === 'cancelled' || response.cancelled === true) return { outcome: { outcome: 'cancelled' } }
  const answersObj = isRecord(response.answers) ? response.answers : response
  let candidate: string | undefined
  const byId = answersObj[request.toolCall.toolCallId]
  if (typeof byId === 'string' && byId.trim()) candidate = byId.trim()
  else if (Array.isArray(byId) && typeof byId[0] === 'string' && byId[0].trim()) candidate = byId[0].trim()
  else {
    for (const val of Object.values(answersObj)) {
      if (typeof val === 'string' && val.trim()) { candidate = val.trim(); break }
      if (Array.isArray(val) && typeof val[0] === 'string' && val[0].trim()) { candidate = val[0].trim(); break }
    }
  }
  if (!candidate) return { outcome: { outcome: 'cancelled' } }
  const rawInput = isRecord(request.toolCall.rawInput) ? request.toolCall.rawInput : null
  const rawQuestions = rawInput && Array.isArray(rawInput.questions) ? rawInput.questions : null
  const firstRawQuestion = rawQuestions && isRecord(rawQuestions[0]) ? rawQuestions[0] : null
  const questionText =
    (firstRawQuestion && typeof firstRawQuestion.question === 'string' && firstRawQuestion.question.trim()) ||
    (typeof request.toolCall.title === 'string' && request.toolCall.title.trim()) ||
    'Question'
  const recordAnswer = (label: string) => {
    recordAnsweredQuestionSummary(
      request.toolCall.toolCallId,
      `"${questionText.replace(/"/g, '\\"')}"="${label.replace(/"/g, '\\"')}"`,
    )
  }
  const exact = request.options.find((opt) => opt.optionId === candidate)
  if (exact) {
    recordAnswer(questionOptionLabel(exact))
    return { outcome: { outcome: 'selected', optionId: exact.optionId } }
  }
  const byLabel = request.options.filter((opt) => questionOptionLabel(opt) === candidate)
  if (byLabel.length === 1 && byLabel[0]) {
    recordAnswer(questionOptionLabel(byLabel[0]))
    return { outcome: { outcome: 'selected', optionId: byLabel[0].optionId } }
  }
  const otherOpt = request.options.find((opt) => opt.optionId === 'other')
  if (otherOpt) {
    recordAnswer(candidate)
    return { outcome: { outcome: 'selected', optionId: otherOpt.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

export interface AntigravityElicitationCreateResult {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

interface ParsedElicitationQuestion {
  key: string
  questionText: string
  multiSelect: boolean
  options: Array<{ constId: string; label: string }>
}

function parseElicitationQuestions(rawParams: unknown): {
  sessionId?: string
  toolCallId?: string
  questions: ParsedElicitationQuestion[]
} | null {
  if (!isRecord(rawParams)) return null
  const sessionId =
    typeof rawParams.sessionId === 'string' && rawParams.sessionId.trim()
      ? rawParams.sessionId.trim()
      : undefined
  const toolCallId =
    typeof rawParams.toolCallId === 'string' && rawParams.toolCallId.trim()
      ? rawParams.toolCallId.trim()
      : undefined
  const schema = isRecord(rawParams.requestedSchema) ? rawParams.requestedSchema : null
  const props = schema && isRecord(schema.properties) ? schema.properties : null
  if (!props) return null
  const questionEntries = Object.entries(props)
    .map(([key, prop]) => {
      const m = /^q(\d+)$/.exec(key)
      return m ? { key, index: Number.parseInt(m[1]!, 10), prop } : null
    })
    .filter((entry): entry is { key: string; index: number; prop: unknown } => entry !== null)
    .sort((a, b) => a.index - b.index)
  if (questionEntries.length === 0) return null
  const questions: ParsedElicitationQuestion[] = []
  for (const { key, prop } of questionEntries) {
    if (!isRecord(prop)) continue
    const rawText =
      (typeof prop.description === 'string' && prop.description.trim()) ||
      (typeof prop.title === 'string' && prop.title.trim()) ||
      ''
    if (!rawText) continue
    const questionText =
      rawText.length > TOOL_TEXT_LIMIT
        ? copyBoundedText(`${rawText.slice(0, TOOL_TEXT_LIMIT - 3)}...`)
        : rawText
    const isArrayType = prop.type === 'array'
    const itemsObj = isArrayType && isRecord(prop.items) ? prop.items : null
    const rawOptionList =
      itemsObj && Array.isArray(itemsObj.anyOf)
        ? itemsObj.anyOf
        : Array.isArray(prop.oneOf)
          ? prop.oneOf
          : []
    const multiSelect = Boolean(itemsObj && Array.isArray(itemsObj.anyOf))
    const options: Array<{ constId: string; label: string }> = []
    for (const rawOpt of rawOptionList) {
      if (!isRecord(rawOpt)) continue
      const constId =
        typeof rawOpt.const === 'string' && rawOpt.const.trim()
          ? rawOpt.const.trim()
          : typeof rawOpt.const === 'number'
            ? String(rawOpt.const)
            : ''
      const rawLabel =
        (typeof rawOpt.title === 'string' && rawOpt.title.trim()) || constId
      if (!constId || !rawLabel) continue
      const label =
        rawLabel.length > QUESTION_LABEL_LIMIT
          ? copyBoundedText(`${rawLabel.slice(0, QUESTION_LABEL_LIMIT - 3)}...`)
          : rawLabel
      options.push({ constId, label })
    }
    questions.push({ key, questionText, multiSelect, options })
  }
  if (questions.length === 0) return null
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    questions,
  }
}

export function extractAntigravityElicitationQuestion(
  rawParams: unknown,
): GrokAskUserQuestionParams | null {
  const parsed = parseElicitationQuestions(rawParams)
  if (!parsed) return null
  return {
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    ...(parsed.toolCallId ? { toolCallId: parsed.toolCallId } : {}),
    questions: parsed.questions.map((q) => ({
      id: q.key,
      header: 'Question',
      question: q.questionText,
      multiSelect: q.multiSelect,
      options: q.options.map((opt) => ({
        label: opt.label,
        description: '',
      })),
    })),
  }
}

function matchElicitationMultiSelect(
  parts: string[],
  joinedText: string,
  options: ReadonlyArray<{ constId: string; label: string }>,
): { selectedIds: string[]; displayLabels: string[]; otherText: string } {
  const selectedIds: string[] = []
  const displayLabels: string[] = []
  const seenIds = new Set<string>()
  let remainingJoined = joinedText
  const commaOptions = options.filter((opt) => opt.label.includes(', '))
  for (const opt of commaOptions) {
    if (remainingJoined.includes(opt.label) && !seenIds.has(opt.constId)) {
      seenIds.add(opt.constId)
      selectedIds.push(opt.constId)
      displayLabels.push(opt.label)
      remainingJoined = remainingJoined.replace(opt.label, '')
    }
  }
  const effectiveParts =
    commaOptions.length > 0 && selectedIds.length > 0
      ? remainingJoined.split(',').map((s) => s.trim()).filter(Boolean)
      : parts
  const unmatched: string[] = []
  for (const part of effectiveParts) {
    const matched = options.find((opt) => opt.label === part || opt.constId === part)
    if (matched) {
      if (!seenIds.has(matched.constId)) {
        seenIds.add(matched.constId)
        selectedIds.push(matched.constId)
        displayLabels.push(matched.label)
      }
    } else if (part) {
      unmatched.push(part)
      displayLabels.push(part)
    }
  }
  return {
    selectedIds,
    displayLabels,
    otherText: unmatched.join(', '),
  }
}

export function makeAntigravityElicitationResponse(
  rawParams: unknown,
  response: Record<string, unknown>,
): AntigravityElicitationCreateResult {
  const parsed = parseElicitationQuestions(rawParams)
  if (response.outcome === 'cancelled' || response.cancelled === true || !parsed) {
    if (parsed?.toolCallId) {
      recordAnsweredQuestionSummary(
        parsed.toolCallId,
        'User dismissed the question without answering.',
      )
    }
    return { action: 'accept', content: {} }
  }
  const answersObj = isRecord(response.answers) ? response.answers : response
  const content: Record<string, unknown> = {}
  const summaryParts: string[] = []
  const fallbackValues = Object.values(answersObj)
  for (let i = 0; i < parsed.questions.length; i++) {
    const q = parsed.questions[i]!
    const rawVal =
      answersObj[q.questionText] ??
      answersObj[q.key] ??
      (parsed.questions.length === 1 ? fallbackValues[0] : undefined)
    const parts = Array.isArray(rawVal)
      ? rawVal.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
      : typeof rawVal === 'string' && rawVal.trim()
        ? [rawVal.trim()]
        : []
    const joinedText = parts.join(', ').trim()
    if (!joinedText) continue
    if (!q.multiSelect) {
      const matched = q.options.find(
        (opt) => opt.label === joinedText || opt.constId === joinedText,
      )
      if (matched) {
        content[q.key] = matched.constId
        summaryParts.push(`"${q.questionText}"="${matched.label}"`)
      } else if (q.options.length === 0) {
        content[q.key] = joinedText
        summaryParts.push(`"${q.questionText}"="${joinedText}"`)
      } else {
        content[`${q.key}_other`] = joinedText
        summaryParts.push(`"${q.questionText}"="${joinedText}"`)
      }
    } else {
      const multi = matchElicitationMultiSelect(parts, joinedText, q.options)
      if (multi.selectedIds.length > 0) {
        content[q.key] = multi.selectedIds
      }
      if (multi.otherText) {
        content[`${q.key}_other`] = multi.otherText
      }
      const display = multi.displayLabels.join(', ') || joinedText
      summaryParts.push(`"${q.questionText}"="${display}"`)
    }
  }
  if (parsed.toolCallId && summaryParts.length > 0) {
    recordAnsweredQuestionSummary(parsed.toolCallId, summaryParts.join(', '))
  }
  return { action: 'accept', content }
}

export function antigravityPermissionMode(mode: PermissionMode | undefined | null): string {
  switch (mode) {
    case 'auto':
    case 'acceptEdits': return 'accept-edits'
    case 'plan': return 'plan'
    case 'bypassPermissions':
    case 'default':
    default: return 'default'
  }
}

export function isAntigravitySandboxBypassRequest(request: RequestPermissionRequest): boolean {
  const rawInput = request.toolCall?.rawInput
  if (!isRecord(rawInput)) return false
  if (rawInput.BypassSandbox === true || rawInput.bypass_sandbox === true || rawInput.bypassSandbox === true) {
    return true
  }
  const nested = rawInput.tool_input ?? rawInput.arguments
  if (isRecord(nested)) {
    return (
      nested.BypassSandbox === true ||
      nested.bypass_sandbox === true ||
      nested.bypassSandbox === true
    )
  }
  return false
}

export function antigravityPermissionDisposition(mode: PermissionMode | undefined | null, request: RequestPermissionRequest): 'allow' | 'ask' {
  if (isAntigravityUserInputRequest(request)) return 'ask'
  if (mode === 'bypassPermissions') return 'allow'
  if (extractAntigravitySecurityWarning(request.options)) return 'ask'
  const kind = request.toolCall?.kind
  if (typeof kind === 'string' && ReadOnlyKinds.has(kind)) return 'allow'
  switch (mode) {
    case 'acceptEdits': return typeof kind === 'string' && MutationKinds.has(kind) ? 'allow' : 'ask'
    case 'auto':
      if (kind === 'execute') {
        return isAntigravitySandboxBypassRequest(request) ? 'ask' : 'allow'
      }
      return 'ask'
    case 'plan':
    case 'default':
    default: return 'ask'
  }
}

export function selectAntigravityAutoApprovedOptionId(request: RequestPermissionRequest): string | null {
  const allowOnce = request.options.find((opt) => opt.kind === 'allow_once')
  if (allowOnce?.optionId) return allowOnce.optionId
  return request.options.find((opt) => opt.kind === 'allow_always')?.optionId ?? null
}
