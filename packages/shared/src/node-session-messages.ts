import type {
  AskUserQuestionRequest,
  ChatMessage,
  CodexReasoningEffort,
  EffortLevel,
  PermissionMode,
  SandboxMode,
  ContentBlock,
  PermissionRequest,
  PlanApprovalRequest,
  SessionAgentRequestPayload,
  UserQuestion,
} from './agent-types'
import { asQuestionPreviewFormat } from './ask-user-question'

export type NodeTranscriptBlock = {
  id?: string
  role?: string
  text?: string
  createdAt?: number
}

export type NodePendingInteraction = Pick<PermissionRequest, 'schemaForm' | 'elicitationForm' | 'subtitle' | 'riskLevel' | 'supportsAlwaysPersist' | 'inputRequest' | 'permissionDetails'> & {
  interactionId: string
  kind?: 'permission' | 'question' | 'plan' | 'session_agents_confirm'
  toolName?: string
  toolUseId?: string
  input?: Record<string, unknown>
  createdAt?: number
  requestKind?: string
  message?: string
  serverName?: string
  allowAlwaysAllow?: boolean
  sessionAgentsConfirm?: {
    launches?: unknown[]
    profiles?: unknown[]
  }
}

export type NodeSessionSnapshot = {
  sessionId?: string
  title?: string | null
  status?: string
  harnessId?: string
  providerId?: string
  acpAgentId?: string | null
  model?: string | null
  effort?: EffortLevel | CodexReasoningEffort | null
  permissionMode?: PermissionMode | null
  sandboxMode?: SandboxMode | null
  apiProviderId?: string | null
  cwd?: string | null
  transcript?: NodeTranscriptBlock[]
  pendingInteraction?: NodePendingInteraction | null
  /** Open `composer_request` forms; they never occupy `pendingInteraction`. */
  pendingInputRequests?: NodePendingInteraction[]
  updatedAt?: number
  /**
   * Prefixed harness resume token from SessionRuntime
   * (`claude-session:…` / `thread:…` / …). Used to surface bare
   * `providerSessionId` for sidebar Copy Session ID.
   */
  providerResume?: string | null
  /** Bare harness session id when the node already strips the resume prefix. */
  providerSessionId?: string | null
  /** The node's own user took the session back; reconnect re-acquires with `reclaim`. */
  controlReleased?: boolean
}

/** Map node pending permission into desktop PermissionRequest for the prompt UI. */
export function nodePendingToPermissionRequest(
  pending: NodePendingInteraction | null | undefined,
): PermissionRequest | null {
  if (!pending?.interactionId) return null
  // Multi-launch agent collaboration confirm (session_collab_request).
  if (pending.kind === 'session_agents_confirm') {
    const confirm = pending.sessionAgentsConfirm
    const payload: SessionAgentRequestPayload = {
      launches: Array.isArray(confirm?.launches)
        ? (confirm!.launches as SessionAgentRequestPayload['launches'])
        : [],
      profiles: Array.isArray(confirm?.profiles)
        ? (confirm!.profiles as SessionAgentRequestPayload['profiles'])
        : [],
    }
    return {
      requestId: pending.interactionId,
      toolName: pending.toolName || 'session_collab_request',
      toolUseId: pending.toolUseId ?? pending.interactionId,
      input: pending.input && typeof pending.input === 'object' ? pending.input : {},
      allowAlwaysAllow: false,
      requestKind: 'session_agents_confirm',
      serverName: pending.serverName || 'superone',
      message:
        pending.message || 'Allow this agent to start the following sessions?',
      sessionAgentsConfirm: payload,
    }
  }
  // Permission UI only — question/plan use dedicated mappers below.
  if (pending.kind && pending.kind !== 'permission') return null
  if (pending.requestKind === 'input_request') {
    if (!pending.inputRequest || !pending.schemaForm) return null
    return {
      requestId: pending.interactionId,
      toolName: pending.toolName || 'composer_request',
      toolUseId: pending.toolUseId ?? pending.interactionId,
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'input_request',
      serverName: pending.serverName || 'superone',
      message: pending.message || pending.inputRequest.title,
      schemaForm: pending.schemaForm,
      inputRequest: pending.inputRequest,
    }
  }
  const input = pending.input && typeof pending.input === 'object' ? pending.input : {}
  const elicitationUrl = typeof input.elicitationUrl === 'string' ? input.elicitationUrl : undefined
  const elicitationId = typeof input.elicitationId === 'string' ? input.elicitationId : undefined
  const schemaForm = pending.schemaForm ?? (input.schemaForm && typeof input.schemaForm === 'object'
    ? input.schemaForm as PermissionRequest['schemaForm']
    : undefined)
  const requestKind = pending.requestKind === 'mcp_elicitation' ? 'mcp_elicitation' as const : undefined
  return {
    requestId: pending.interactionId,
    toolName: pending.toolName || 'tool',
    toolUseId: pending.toolUseId,
    input,
    allowAlwaysAllow: requestKind === 'mcp_elicitation' ? !schemaForm && pending.allowAlwaysAllow === true : pending.allowAlwaysAllow !== false,
    ...(requestKind ? { requestKind } : {}),
    ...(pending.message ? { message: pending.message } : {}),
    ...(pending.permissionDetails ? { permissionDetails: pending.permissionDetails } : {}),
    ...(pending.serverName ? { serverName: pending.serverName } : {}),
    ...(elicitationUrl ? { elicitationUrl, subtitle: elicitationUrl } : {}),
    ...(elicitationId ? { elicitationId } : {}),
    ...(schemaForm ? { schemaForm } : {}),
    ...(pending.elicitationForm ? { elicitationForm: pending.elicitationForm } : {}),
    ...(pending.subtitle ? { subtitle: pending.subtitle } : {}),
    ...(pending.riskLevel ? { riskLevel: pending.riskLevel } : {}),
    ...(pending.supportsAlwaysPersist !== undefined ? { supportsAlwaysPersist: pending.supportsAlwaysPersist } : {}),
  }
}

/**
 * Map node question pendingInteraction into chat-store `pendingQuestion`
 * (`AskUserQuestionRequest`).
 */
export function nodePendingToQuestionRequest(
  pending: NodePendingInteraction | null | undefined,
): AskUserQuestionRequest | null {
  if (!pending?.interactionId || pending.kind !== 'question') return null
  const input =
    pending.input && typeof pending.input === 'object' ? pending.input : {}
  const raw = Array.isArray((input as { questions?: unknown }).questions)
    ? ((input as { questions: unknown[] }).questions)
    : []
  const questions: UserQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    const row = q as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question : ''
    if (!question) continue
    const optionsRaw = Array.isArray(row.options) ? row.options : []
    const options = optionsRaw
      .map((opt) => {
        if (!opt || typeof opt !== 'object') return null
        const o = opt as Record<string, unknown>
        const label = typeof o.label === 'string' ? o.label : ''
        if (!label) return null
        return {
          label,
          description: typeof o.description === 'string' ? o.description : '',
          ...(typeof o.preview === 'string' ? { preview: o.preview } : {}),
        }
      })
      .filter((o): o is NonNullable<typeof o> => o != null)
    questions.push({
      question,
      header: typeof row.header === 'string' ? row.header : question,
      options,
      multiSelect: row.multiSelect === true || row.multiple === true,
    })
  }
  if (questions.length === 0) {
    questions.push({
      question: 'Continue?',
      header: 'Question',
      options: [
        { label: 'Yes', description: '' },
        { label: 'No', description: '' },
      ],
      multiSelect: false,
    })
  }
  // The node stamps its own toolConfig format onto the tool input (it is what the
  // model was asked to produce) — the desktop's local preference does not apply here.
  const previewFormat = asQuestionPreviewFormat(
    typeof (input as { previewFormat?: unknown }).previewFormat === 'string'
      ? (input as { previewFormat: string }).previewFormat
      : undefined,
  )
  return {
    requestId: pending.interactionId,
    questions,
    ...(previewFormat ? { previewFormat } : {}),
  }
}

/** @deprecated Use {@link nodePendingToQuestionRequest}. */
export function nodePendingToQuestionPayload(
  pending: NodePendingInteraction | null | undefined,
): { requestId: string; questions: unknown; input: Record<string, unknown> } | null {
  const req = nodePendingToQuestionRequest(pending)
  if (!req) return null
  return {
    requestId: req.requestId,
    questions: req.questions,
    input: pending?.input && typeof pending.input === 'object' ? pending.input : {},
  }
}

/** Map node plan pendingInteraction into chat-store `pendingPlanApproval`. */
export function nodePendingToPlanApprovalRequest(
  pending: NodePendingInteraction | null | undefined,
): PlanApprovalRequest | null {
  if (!pending?.interactionId || pending.kind !== 'plan') return null
  const input =
    pending.input && typeof pending.input === 'object' ? pending.input : {}
  const plan =
    typeof (input as { plan?: unknown }).plan === 'string'
      ? (input as { plan: string }).plan
      : typeof (input as { planContent?: unknown }).planContent === 'string'
        ? (input as { planContent: string }).planContent
        : input.plan && typeof input.plan === 'object'
          ? JSON.stringify(input.plan)
          : 'Plan approval required'
  return {
    requestId: pending.interactionId,
    planContent: plan,
    planFilePath:
      typeof (input as { planFilePath?: unknown }).planFilePath === 'string'
        ? (input as { planFilePath: string }).planFilePath
        : '',
    allowedPrompts: Array.isArray((input as { allowedPrompts?: unknown }).allowedPrompts)
      ? ((input as { allowedPrompts: PlanApprovalRequest['allowedPrompts'] }).allowedPrompts)
      : [],
  }
}

/** @deprecated Use {@link nodePendingToPlanApprovalRequest}. */
export function nodePendingToPlanPayload(
  pending: NodePendingInteraction | null | undefined,
): { requestId: string; plan: unknown; input: Record<string, unknown> } | null {
  const req = nodePendingToPlanApprovalRequest(pending)
  if (!req) return null
  return {
    requestId: req.requestId,
    plan: req.planContent,
    input: pending?.input && typeof pending.input === 'object' ? pending.input : {},
  }
}

/** Build pending interaction fields for chat-store from a node session snapshot. */
export function nodePendingInteractionFields(
  pending: NodePendingInteraction | null | undefined,
  /** `NodeSessionSnapshot.pendingInputRequests`; listed after the harness prompt. */
  inputRequests: readonly NodePendingInteraction[] = [],
): {
  pendingPermissions: PermissionRequest[]
  pendingQuestion: AskUserQuestionRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  awaitingAssistantReply: boolean
} {
  const perm = nodePendingToPermissionRequest(pending)
  const question = nodePendingToQuestionRequest(pending)
  const plan = nodePendingToPlanApprovalRequest(pending)
  const forms = inputRequests.flatMap(request => nodePendingToPermissionRequest(request) ?? [])
  return {
    pendingPermissions: [...(perm ? [perm] : []), ...forms],
    pendingQuestion: question,
    pendingPlanApproval: plan,
    awaitingAssistantReply: Boolean(perm || question || plan || forms.length),
  }
}

export function nodeStatusToAgentStatus(
  status: string | undefined,
): 'idle' | 'streaming' | 'error' {
  if (status === 'streaming') return 'streaming'
  if (status === 'error') return 'error'
  return 'idle'
}

/** Normalize node harnessId into a chat session provider id. */
export function nodeHarnessToProviderId(harnessId: string | undefined | null): string {
  if (harnessId === 'claude' || harnessId === 'codex' || harnessId === 'acp' || harnessId === 'opencode') {
    return harnessId
  }
  return harnessId || 'claude'
}
