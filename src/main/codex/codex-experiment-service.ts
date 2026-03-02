import { execFileSync, spawn } from 'child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { basename, extname, join } from 'path'
import { createInterface } from 'readline'
import log from '../logger'
import {
  CODEX_PERMISSION_PRESETS,
  DEFAULT_CODEX_PERMISSION_PRESET,
  DEFAULT_CODEX_PERMISSION_PROFILE,
} from '../../shared/agent-types'
import type {
  CodexApprovalMode,
  CodexAuthMode,
  CodexAuthStatus,
  CodexCommandExecutionStatus,
  CodexCompactRequest,
  CodexMcpToolCallStatus,
  CodexPatchApplyStatus,
  CodexPatchChangeKind,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexReviewRequest,
  CodexSandboxMode,
  CodexThreadItem,
  CodexUsageInfo,
  ImageAttachment,
  ModelOption,
  PermissionRequest,
  ReasoningEffortOption,
  CodexRunRequest,
  CodexRunResult,
  CodexSetAuthRequest,
} from '../../shared/agent-types'

interface CodexSession {
  mode: CodexAuthMode
  apiKey?: string
  model?: string
  modelReasoningEffort?: CodexReasoningEffort
  permissionPreset: CodexPermissionPreset
  threadId: string | null
  runningController: AbortController | null
  modelCache: { fetchedAt: number; models: ModelOption[] } | null
  pendingApprovals: Map<string, PendingCodexApproval>
  activeTurnId: string | null
  steerFn: ((input: string) => Promise<void>) | null
}

interface CodexRunStreamCallbacks {
  onThreadStarted?: (threadId: string) => void
  onItemDelta?: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => void
  onUsageDelta?: (usage: CodexUsageInfo) => void
  onPermissionRequest?: (request: PermissionRequest) => void
}

type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline'

interface PendingCodexApproval {
  resolve: (decision: CodexApprovalDecision) => void
  reject: (error: Error) => void
}

interface CodexAppServerModel {
  id: string
  model: string
  displayName: string
  description: string
  isDefault: boolean
  supportedReasoningEfforts: ReasoningEffortOption[]
  defaultReasoningEffort?: CodexReasoningEffort
}

type JsonRpcRequestId = string | number

interface AppServerNotification {
  requestIdRaw?: JsonRpcRequestId
  requestId?: string
  method: string
  params: Record<string, unknown>
}

interface AppServerConnection {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  respond(requestId: JsonRpcRequestId, result?: Record<string, unknown>): Promise<void>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  nextNotification(): Promise<AppServerNotification>
}

const APP_SERVER_RESPONSE_TIMEOUT_MS = 15_000
const MODEL_CACHE_TTL_MS = 60_000
const moduleRequire = createRequire(import.meta.url)

function resolveCodexPlatformPackage(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  if (platform === 'darwin' && arch === 'x64') return '@openai/codex-darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return '@openai/codex-darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return '@openai/codex-linux-x64'
  if (platform === 'linux' && arch === 'arm64') return '@openai/codex-linux-arm64'
  if (platform === 'win32' && arch === 'x64') return '@openai/codex-win32-x64'
  if (platform === 'win32' && arch === 'arm64') return '@openai/codex-win32-arm64'
  return null
}

function hasCodexPlatformPackage(packageName: string): boolean {
  try {
    moduleRequire.resolve(`${packageName}/package.json`)
    return true
  } catch {
    return false
  }
}

function findSystemCodexCli(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : '/usr/bin/which'
  try {
    const out = execFileSync(cmd, ['codex'], { timeout: 3000, stdio: 'pipe' }).toString()
    const candidate = out.split(/\r?\n/).map((v) => v.trim()).find(Boolean)
    return candidate ?? null
  } catch {
    return null
  }
}

function normalizeApiKey(value?: string): string | undefined {
  const key = value?.trim()
  return key ? key : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null)
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

function sanitizeAttachmentName(name: string): string {
  const trimmed = basename(name.trim() || 'image')
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]/g, '-')
  const normalized = cleaned.replace(/-+/g, '-').slice(0, 80)
  return normalized || 'image'
}

function inferImageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
      return '.bmp'
    case 'image/tiff':
      return '.tiff'
    case 'image/svg+xml':
      return '.svg'
    default:
      return ''
  }
}

function cleanupPersistedImageAttachments(paths: string[]): void {
  for (const filePath of paths) {
    try {
      unlinkSync(filePath)
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function persistImageAttachments(projectPath: string, images: ImageAttachment[]): string[] {
  const targetDir = join(projectPath, '.super-one', 'codex-attachments')
  mkdirSync(targetDir, { recursive: true })

  const writtenPaths: string[] = []
  try {
    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      const normalizedName = sanitizeAttachmentName(image.name || `image-${i + 1}`)
      const extension = extname(normalizedName) || inferImageExtension(image.mimeType)
      const baseName = extname(normalizedName) ? normalizedName.slice(0, -extname(normalizedName).length) : normalizedName
      const fileName = `${Date.now()}-${i}-${baseName}${extension}`
      const filePath = join(targetDir, fileName)
      writeFileSync(filePath, Buffer.from(image.base64, 'base64'))
      writtenPaths.push(filePath)
    }
    return writtenPaths
  } catch (error) {
    cleanupPersistedImageAttachments(writtenPaths)
    throw error
  }
}

function resolveApiKey(mode: CodexAuthMode, sessionApiKey?: string): string | undefined {
  if (mode === 'chatgpt') return undefined
  if (mode === 'apiKey') return normalizeApiKey(sessionApiKey) ?? normalizeApiKey(process.env.CODEX_API_KEY)
  return normalizeApiKey(sessionApiKey) ?? normalizeApiKey(process.env.CODEX_API_KEY)
}

function resolveMode(mode: CodexAuthMode, sessionApiKey?: string): 'chatgpt' | 'apiKey' {
  return resolveApiKey(mode, sessionApiKey) ? 'apiKey' : 'chatgpt'
}

function resolvePermissionProfile(
  permissionPreset?: CodexPermissionPreset,
): {
  permissionPreset: CodexPermissionPreset
  approvalPolicy: CodexApprovalMode
  sandboxMode: CodexSandboxMode
  networkAccessEnabled: boolean
} {
  const resolvedPreset = permissionPreset ?? DEFAULT_CODEX_PERMISSION_PRESET
  const profile = CODEX_PERMISSION_PRESETS[resolvedPreset] ?? DEFAULT_CODEX_PERMISSION_PROFILE
  return {
    permissionPreset: resolvedPreset,
    approvalPolicy: profile.approvalPolicy,
    sandboxMode: profile.sandboxMode,
    networkAccessEnabled: profile.networkAccessEnabled,
  }
}

function mapPatchChangeKind(raw: unknown): CodexPatchChangeKind {
  const direct = readString(raw)
  if (direct === 'add' || direct === 'delete' || direct === 'update') return direct

  const rec = asRecord(raw)
  const kind = readString(rec?.type)
  if (kind === 'add' || kind === 'delete' || kind === 'update') return kind

  return 'update'
}

function mapCommandExecutionStatus(raw: unknown): CodexCommandExecutionStatus {
  const status = readString(raw)
  switch (status) {
    case 'in_progress':
    case 'inProgress':
      return 'in_progress'
    case 'failed':
    case 'declined':
      return 'failed'
    case 'completed':
    default:
      return 'completed'
  }
}

function mapPatchApplyStatus(raw: unknown): CodexPatchApplyStatus {
  const status = readString(raw)
  switch (status) {
    case 'failed':
    case 'declined':
      return 'failed'
    case 'completed':
    case 'in_progress':
    case 'inProgress':
    default:
      return 'completed'
  }
}

function mapMcpToolCallStatus(raw: unknown): CodexMcpToolCallStatus {
  const status = readString(raw)
  switch (status) {
    case 'in_progress':
    case 'inProgress':
      return 'in_progress'
    case 'failed':
      return 'failed'
    case 'completed':
    default:
      return 'completed'
  }
}

function mapThreadItemFromAppServer(raw: unknown, previous?: CodexThreadItem): CodexThreadItem | null {
  const rec = asRecord(raw)
  if (!rec) return null

  const type = readString(rec.type)
  const id = readString(rec.id) ?? previous?.id
  if (!type || !id) return null

  switch (type) {
    case 'agent_message':
    case 'agentMessage': {
      const text = readString(rec.text) ?? (previous?.type === 'agent_message' ? previous.text : '')
      return { id, type: 'agent_message', text }
    }

    case 'reasoning': {
      const text =
        readString(rec.text)
        ?? (readStringArray(rec.summary).join('\n\n')
          || readStringArray(rec.content).join('\n\n')
          || (previous?.type === 'reasoning' ? previous.text : ''))
      return { id, type: 'reasoning', text }
    }

    case 'command_execution':
    case 'commandExecution': {
      const prevCommand = previous?.type === 'command_execution' ? previous : null
      const command = readString(rec.command) ?? prevCommand?.command ?? ''
      const aggregatedOutput = readString(rec.aggregatedOutput)
        ?? readString(rec.aggregated_output)
        ?? prevCommand?.aggregatedOutput
        ?? ''
      const exitCode = readNumber(rec.exitCode) ?? readNumber(rec.exit_code)
      return {
        id,
        type: 'command_execution',
        command,
        aggregatedOutput,
        ...(exitCode !== null ? { exitCode } : {}),
        status: mapCommandExecutionStatus(rec.status ?? prevCommand?.status),
      }
    }

    case 'file_change':
    case 'fileChange': {
      const changes = Array.isArray(rec.changes)
        ? rec.changes
            .map((entry) => {
              const change = asRecord(entry)
              const path = readString(change?.path)
              if (!path) return null
              const diff = readString(change?.diff)
              return {
                path,
                kind: mapPatchChangeKind(change?.kind),
                ...(diff !== null ? { diff } : {}),
              }
            })
            .filter((entry): entry is { path: string; kind: CodexPatchChangeKind; diff?: string } => entry !== null)
        : (previous?.type === 'file_change' ? previous.changes : [])
      return {
        id,
        type: 'file_change',
        changes,
        status: mapPatchApplyStatus(rec.status ?? (previous?.type === 'file_change' ? previous.status : undefined)),
      }
    }

    case 'mcp_tool_call':
    case 'mcpToolCall': {
      const prevMcp = previous?.type === 'mcp_tool_call' ? previous : null
      const resultRec = asRecord(rec.result)
      const errorRec = asRecord(rec.error)
      return {
        id,
        type: 'mcp_tool_call',
        server: readString(rec.server) ?? prevMcp?.server ?? '',
        tool: readString(rec.tool) ?? prevMcp?.tool ?? '',
        arguments: rec.arguments ?? prevMcp?.arguments ?? {},
        ...(resultRec
          ? {
              result: {
                content: Array.isArray(resultRec.content) ? resultRec.content : [],
                structuredContent: resultRec.structuredContent ?? resultRec.structured_content ?? null,
              },
            }
          : prevMcp?.result
          ? { result: prevMcp.result }
          : {}),
        ...(errorRec
          ? { error: { message: readString(errorRec.message) ?? 'Unknown MCP tool error' } }
          : prevMcp?.error
          ? { error: prevMcp.error }
          : {}),
        status: mapMcpToolCallStatus(rec.status ?? prevMcp?.status),
      }
    }

    case 'web_search':
    case 'webSearch':
      return {
        id,
        type: 'web_search',
        query: readString(rec.query) ?? (previous?.type === 'web_search' ? previous.query : ''),
      }

    case 'todo_list':
    case 'todoList': {
      const items = Array.isArray(rec.items)
        ? rec.items
            .map((entry) => {
              const todo = asRecord(entry)
              const text = readString(todo?.text)
              if (!text) return null
              return { text, completed: readBoolean(todo?.completed) ?? false }
            })
            .filter((entry): entry is { text: string; completed: boolean } => entry !== null)
        : (previous?.type === 'todo_list' ? previous.items : [])
      return {
        id,
        type: 'todo_list',
        items,
      }
    }

    case 'error':
      return {
        id,
        type: 'error',
        message: readString(rec.message) ?? (previous?.type === 'error' ? previous.message : 'Unknown error'),
      }

    case 'plan': {
      const text = readString(rec.text)
      if (!text) return null
      return {
        id,
        type: 'reasoning',
        text,
      }
    }

    case 'enteredReviewMode': {
      const text = readString(rec.text) ?? ''
      return { id, type: 'review', phase: 'entered', text }
    }

    case 'exitedReviewMode': {
      const text = readString(rec.text) ?? ''
      return { id, type: 'review', phase: 'exited', text }
    }

    case 'contextCompaction':
      return { id, type: 'compaction' }

    default:
      return null
  }
}

function upsertItem(order: string[], map: Map<string, CodexThreadItem>, item: CodexThreadItem): void {
  if (!map.has(item.id)) order.push(item.id)
  map.set(item.id, item)
}

function mapUsage(inputTokens: number, outputTokens: number, cachedInputTokens: number): CodexUsageInfo {
  return { inputTokens, outputTokens, cachedInputTokens }
}

function mapUsageFromTokenUsage(raw: unknown): CodexUsageInfo | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const breakdown = asRecord(rec.last) ?? asRecord(rec.total)
  if (!breakdown) return null

  const inputTokens = readNumber(breakdown.inputTokens) ?? 0
  const outputTokens = readNumber(breakdown.outputTokens) ?? 0
  const cachedInputTokens = readNumber(breakdown.cachedInputTokens) ?? 0

  return mapUsage(inputTokens, outputTokens, cachedInputTokens)
}

function deriveFinalResponse(items: CodexThreadItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'agent_message') return item.text
  }
  return ''
}

function extractJsonRpcErrorMessage(raw: unknown): string {
  const rec = asRecord(raw)
  if (!rec) return 'Unknown app-server error'
  return readString(rec.message) ?? 'Unknown app-server error'
}

function extractTurnErrorMessage(raw: unknown): string {
  const rec = asRecord(raw)
  if (!rec) return 'Codex turn failed'

  const direct = readString(rec.message)
  if (direct) return direct

  const nested = asRecord(rec.error)
  return readString(nested?.message) ?? 'Codex turn failed'
}

function mapApprovalRequest(notification: AppServerNotification): PermissionRequest | null {
  const requestId = notification.requestId
  if (!requestId) return null

  if (notification.method === 'item/commandExecution/requestApproval') {
    const command = readString(notification.params.command) ?? ''
    const cwd = readString(notification.params.cwd) ?? undefined
    const reason = readString(notification.params.reason) ?? undefined
    return {
      requestId,
      toolName: 'Bash',
      toolUseId: requestId,
      input: compactRecord({
        command,
        cwd,
      }),
      decisionReason: reason,
      allowAlwaysAllow: true,
    }
  }

  if (notification.method === 'item/fileChange/requestApproval') {
    const grantRoot = readString(notification.params.grantRoot) ?? undefined
    const reason = readString(notification.params.reason) ?? undefined
    return {
      requestId,
      toolName: 'FileChange',
      toolUseId: requestId,
      input: compactRecord({
        file_path: grantRoot,
        kind: 'grant_root',
      }),
      decisionReason: reason,
      blockedPath: grantRoot,
      allowAlwaysAllow: true,
    }
  }

  return null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function parseAppServerModel(raw: unknown): CodexAppServerModel | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const id = typeof rec.id === 'string' ? rec.id : null
  const model = typeof rec.model === 'string' ? rec.model : null
  if (!id || !model) return null
  return {
    id,
    model,
    displayName: typeof rec.displayName === 'string' ? rec.displayName : model,
    description: typeof rec.description === 'string' ? rec.description : '',
    isDefault: rec.isDefault === true,
    supportedReasoningEfforts: Array.isArray(rec.supportedReasoningEfforts)
      ? rec.supportedReasoningEfforts
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const effort = (entry as Record<string, unknown>).reasoningEffort
            const description = (entry as Record<string, unknown>).description
            if (
              effort !== 'minimal'
              && effort !== 'low'
              && effort !== 'medium'
              && effort !== 'high'
              && effort !== 'xhigh'
            ) {
              return null
            }
            return {
              value: effort,
              description: typeof description === 'string' ? description : effort,
            } satisfies ReasoningEffortOption
          })
          .filter((entry): entry is ReasoningEffortOption => Boolean(entry))
      : [],
    defaultReasoningEffort:
      rec.defaultReasoningEffort === 'minimal'
      || rec.defaultReasoningEffort === 'low'
      || rec.defaultReasoningEffort === 'medium'
      || rec.defaultReasoningEffort === 'high'
      || rec.defaultReasoningEffort === 'xhigh'
        ? rec.defaultReasoningEffort
        : undefined,
  }
}

export class CodexExperimentService {
  private sessions = new Map<string, CodexSession>()
  private codexCliScriptPath: string | null = null

  private rejectPendingApprovals(session: CodexSession, message: string): void {
    if (session.pendingApprovals.size === 0) return
    const error = new Error(message)
    for (const pending of session.pendingApprovals.values()) {
      pending.reject(error)
    }
    session.pendingApprovals.clear()
  }

  private createSession(
    _projectPath: string,
    mode: CodexAuthMode,
    apiKey?: string,
    model?: string,
    threadId?: string,
    modelReasoningEffort?: CodexReasoningEffort,
    permissionPreset?: CodexPermissionPreset,
  ): CodexSession {
    const resolvedPermissionProfile = resolvePermissionProfile(permissionPreset)
    return {
      mode,
      apiKey: normalizeApiKey(apiKey),
      model,
      modelReasoningEffort,
      permissionPreset: resolvedPermissionProfile.permissionPreset,
      threadId: threadId ?? null,
      runningController: null,
      modelCache: null,
      pendingApprovals: new Map<string, PendingCodexApproval>(),
      activeTurnId: null,
      steerFn: null,
    }
  }

  private ensureSession(
    projectPath: string,
    requestedModel?: string,
    requestedThreadId?: string,
    requestedReasoningEffort?: CodexReasoningEffort,
    requestedPermissionPreset?: CodexPermissionPreset,
  ): CodexSession {
    const existing = this.sessions.get(projectPath)
    if (!existing) {
      const created = this.createSession(
        projectPath,
        'auto',
        undefined,
        requestedModel,
        requestedThreadId,
        requestedReasoningEffort,
        requestedPermissionPreset,
      )
      this.sessions.set(projectPath, created)
      return created
    }

    const shouldSwitchThread = Boolean(requestedThreadId && requestedThreadId !== existing.threadId)
    const shouldSwitchModel = Boolean(requestedModel && requestedModel !== existing.model)
    const shouldSwitchReasoningEffort = Boolean(
      requestedReasoningEffort
      && requestedReasoningEffort !== existing.modelReasoningEffort,
    )
    const shouldSwitchPermissionPreset = Boolean(
      requestedPermissionPreset
      && requestedPermissionPreset !== existing.permissionPreset,
    )

    if (
      shouldSwitchThread
      || shouldSwitchModel
      || shouldSwitchReasoningEffort
      || shouldSwitchPermissionPreset
    ) {
      this.rejectPendingApprovals(existing, 'Codex run interrupted')
      if (existing.runningController) existing.runningController.abort()
      const recreated = this.createSession(
        projectPath,
        existing.mode,
        existing.apiKey,
        requestedModel ?? existing.model,
        requestedThreadId ?? existing.threadId ?? undefined,
        requestedReasoningEffort ?? existing.modelReasoningEffort,
        requestedPermissionPreset ?? existing.permissionPreset,
      )
      this.sessions.set(projectPath, recreated)
      return recreated
    }

    return existing
  }

  private resolveCodexCliScriptPath(): string {
    if (this.codexCliScriptPath) return this.codexCliScriptPath
    let resolved = moduleRequire.resolve('@openai/codex/bin/codex.js')
    resolved = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    log.info('[codex] Resolved CLI script:', resolved)
    this.codexCliScriptPath = resolved
    return this.codexCliScriptPath
  }

  private buildAppServerEnv(session: CodexSession): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    // In Electron, process.execPath points to the app binary.
    // Force child process to run in Node mode so it doesn't create a second app instance/Dock icon.
    if (process.versions.electron) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    if (session.mode === 'chatgpt') {
      delete env.CODEX_API_KEY
      return env
    }
    const apiKey = resolveApiKey(session.mode, session.apiKey)
    if (apiKey) env.CODEX_API_KEY = apiKey
    return env
  }

  private mapAppServerModel(m: CodexAppServerModel): ModelOption {
    return {
      id: m.model,
      name: m.displayName || m.model,
      description: m.description,
      isDefault: m.isDefault,
      supportedReasoningEfforts: m.supportedReasoningEfforts,
      defaultReasoningEffort: m.defaultReasoningEffort,
    }
  }

  private buildThreadConfig(
    permissionProfile: {
      sandboxMode: CodexSandboxMode
      networkAccessEnabled: boolean
    },
  ): Record<string, unknown> | undefined {
    if (permissionProfile.sandboxMode !== 'workspace-write') return undefined
    return {
      sandbox_workspace_write: {
        network_access: permissionProfile.networkAccessEnabled,
      },
    }
  }

  private buildTurnSandboxPolicy(
    projectPath: string,
    permissionProfile: {
      sandboxMode: CodexSandboxMode
      networkAccessEnabled: boolean
    },
  ): Record<string, unknown> {
    if (permissionProfile.sandboxMode === 'danger-full-access') {
      return { type: 'dangerFullAccess' }
    }

    if (permissionProfile.sandboxMode === 'read-only') {
      return {
        type: 'readOnly',
        access: { type: 'fullAccess' },
      }
    }

    return {
      type: 'workspaceWrite',
      writableRoots: [projectPath],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: permissionProfile.networkAccessEnabled,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    }
  }

  private async withAppServerConnection<T>(
    session: CodexSession,
    signal: AbortSignal | undefined,
    fn: (connection: AppServerConnection) => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new Error('Codex run interrupted')
    }

    const codexScript = this.resolveCodexCliScriptPath()
    const env = this.buildAppServerEnv(session)
    const expectedPackage = resolveCodexPlatformPackage()
    const hasBundledPackage = expectedPackage ? hasCodexPlatformPackage(expectedPackage) : false
    const systemCodexCli = !hasBundledPackage ? findSystemCodexCli() : null
    log.info(
      '[codex] app-server launch platform=%s arch=%s mode=%s script=%s expectedPackage=%s bundledPackage=%s systemCodex=%s',
      process.platform,
      process.arch,
      session.mode,
      codexScript,
      expectedPackage ?? 'unknown',
      hasBundledPackage,
      systemCodexCli ?? 'none',
    )

    if (!hasBundledPackage && !systemCodexCli) {
      const hint = process.platform === 'darwin'
        ? 'Rebuild dependencies with: bun install --frozen-lockfile --os=darwin --cpu=*'
        : 'Rebuild dependencies for the current target architecture'
      throw new Error(`Missing Codex runtime package (${expectedPackage ?? 'unknown'}). ${hint}`)
    }

    const child = systemCodexCli
      ? spawn(systemCodexCli, ['app-server', '--listen', 'stdio://'], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
          windowsHide: process.platform === 'win32',
        })
      : spawn(process.execPath, [codexScript, 'app-server', '--listen', 'stdio://'], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

    const stdout = child.stdout
    const stdin = child.stdin
    if (!stdout || !stdin) {
      child.kill()
      throw new Error('Failed to start Codex app-server')
    }

    const rl = createInterface({ input: stdout })
    const iterator = rl[Symbol.asyncIterator]()
    const stderrChunks: string[] = []
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => stderrChunks.push(chunk))

    const onAbort = () => {
      if (!child.killed) child.kill()
    }
    signal?.addEventListener('abort', onAbort)

    const sendMessage = async (payload: Record<string, unknown>): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }

    const readMessage = async (): Promise<Record<string, unknown>> => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = await iterator.next()
        if (next.done) {
          throw new Error('Codex app-server closed unexpectedly')
        }
        const line = `${next.value}`.trim()
        if (!line) continue

        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        const rec = asRecord(parsed)
        if (rec) return rec
      }
    }

    const notificationQueue: AppServerNotification[] = []
    let nextRequestId = 1

      const waitForResponse = async (id: number, label: string): Promise<Record<string, unknown>> => {
        const expectedId = String(id)
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const msg = await withTimeout(readMessage(), APP_SERVER_RESPONSE_TIMEOUT_MS, `Codex app-server ${label}`)

          const method = readString(msg.method)
          if (method) {
            const rawId = ('id' in msg && (typeof msg.id === 'string' || typeof msg.id === 'number'))
              ? (msg.id as JsonRpcRequestId)
              : undefined
            notificationQueue.push({
              requestIdRaw: rawId,
              requestId: rawId !== undefined ? String(rawId) : undefined,
              method,
              params: asRecord(msg.params) ?? {},
            })
            continue
          }

        if (!('id' in msg)) continue
        if (String(msg.id) !== expectedId) continue

        if ('error' in msg && msg.error) {
          throw new Error(extractJsonRpcErrorMessage(msg.error))
        }

        const result = asRecord(msg.result)
        return result ?? {}
      }
    }

    const connection: AppServerConnection = {
      request: async (method, params) => {
        const requestId = nextRequestId
        nextRequestId += 1
        await sendMessage(compactRecord({ id: requestId, method, params }))
        return waitForResponse(requestId, method)
      },

      respond: async (requestId, result) => {
        await sendMessage(compactRecord({ id: requestId, result: result ?? {} }))
      },

      notify: async (method, params) => {
        await sendMessage(compactRecord({ method, params }))
      },

      nextNotification: async () => {
        if (notificationQueue.length > 0) {
          const queued = notificationQueue.shift()
          if (queued) return queued
        }

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const msg = await readMessage()
          const method = readString(msg.method)
          if (!method) continue
          const rawId = ('id' in msg && (typeof msg.id === 'string' || typeof msg.id === 'number'))
            ? (msg.id as JsonRpcRequestId)
            : undefined
          return {
            requestIdRaw: rawId,
            requestId: rawId !== undefined ? String(rawId) : undefined,
            method,
            params: asRecord(msg.params) ?? {},
          }
        }
      },
    }

    try {
      await connection.request('initialize', {
        clientInfo: {
          name: 'super-one',
          title: 'Super One',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      })
      await connection.notify('initialized')

      return await fn(connection)
    } catch (error) {
      const stderr = stderrChunks.join('').trim()
      log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
      if (stderr.includes('Missing optional dependency')) {
        log.error(
          '[codex] missing optional dependency detected platform=%s arch=%s expectedPackage=%s',
          process.platform,
          process.arch,
          expectedPackage ?? 'unknown',
        )
      }
      if (stderr) log.error('[codex] app-server stderr:', stderr)
      if (stderr) {
        const message = error instanceof Error ? error.message : String(error)
        const debugLogPath = String(log.transports.file.getFile().path)
        throw new Error(`${message}\n${stderr}\nDebug log: ${debugLogPath}`)
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      rl.close()
      try {
        stdin.end()
      } catch {
        // ignore
      }
      if (!child.killed) child.kill()
    }
  }

  private async fetchModelsFromAppServer(session: CodexSession): Promise<ModelOption[]> {
    return this.withAppServerConnection(session, undefined, async (connection) => {
      const models: CodexAppServerModel[] = []
      let cursor: string | null = null

      do {
        const result = await connection.request(
          'model/list',
          compactRecord({
            limit: 100,
            cursor: cursor ?? undefined,
          }),
        )

        const items = Array.isArray(result.data) ? result.data : []
        for (const raw of items) {
          const parsed = parseAppServerModel(raw)
          if (parsed) models.push(parsed)
        }

        cursor = readString(result.nextCursor)
      } while (cursor)

      const mapped = models.map((m) => this.mapAppServerModel(m))
      if (!mapped.some((m) => m.isDefault) && mapped[0]) {
        mapped[0] = { ...mapped[0], isDefault: true }
      }
      return mapped
    })
  }

  async listModels(projectPath: string): Promise<ModelOption[]> {
    const session = this.ensureSession(projectPath)
    const now = Date.now()
    if (session.modelCache && now - session.modelCache.fetchedAt < MODEL_CACHE_TTL_MS) {
      return session.modelCache.models
    }

    log.info('[codex] listModels: mode=%s, hasApiKey=%s', session.mode, Boolean(session.apiKey || process.env.CODEX_API_KEY))
    const models = await this.fetchModelsFromAppServer(session)
    log.info('[codex] listModels: fetched %d models', models.length)
    session.modelCache = { fetchedAt: now, models }
    return models
  }

  private async resolveThread(
    connection: AppServerConnection,
    session: CodexSession,
    projectPath: string,
    permissionProfile: ReturnType<typeof resolvePermissionProfile>,
  ): Promise<string> {
    const threadConfig = this.buildThreadConfig(permissionProfile)

    const threadResult = session.threadId
      ? await connection.request(
          'thread/resume',
          compactRecord({
            threadId: session.threadId,
            model: session.model,
            cwd: projectPath,
            approvalPolicy: permissionProfile.approvalPolicy,
            sandbox: permissionProfile.sandboxMode,
            config: threadConfig,
            persistExtendedHistory: true,
          }),
        )
      : await connection.request(
          'thread/start',
          compactRecord({
            model: session.model,
            cwd: projectPath,
            approvalPolicy: permissionProfile.approvalPolicy,
            sandbox: permissionProfile.sandboxMode,
            config: threadConfig,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
          }),
        )

    const thread = asRecord(threadResult.thread)
    const resolvedThreadId = readString(thread?.id)
    if (!resolvedThreadId) {
      throw new Error('Failed to resolve Codex thread id')
    }

    session.threadId = resolvedThreadId
    return resolvedThreadId
  }

  private async streamTurnEvents(
    connection: AppServerConnection,
    session: CodexSession,
    activeTurnId: string | null,
    controller: AbortController,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<{ threadId: string | null; usage: CodexUsageInfo | null; items: CodexThreadItem[] }> {
    let threadStartedEmitted = false
    const emitThreadStarted = (threadId: string) => {
      if (threadStartedEmitted) return
      threadStartedEmitted = true
      callbacks?.onThreadStarted?.(threadId)
    }

    if (session.threadId) emitThreadStarted(session.threadId)

    const itemOrder: string[] = []
    const itemMap = new Map<string, CodexThreadItem>()
    let usage: CodexUsageInfo | null = null
    let turnCompleted = false

    const handleServerRequest = async (notification: AppServerNotification): Promise<boolean> => {
      if (notification.requestIdRaw === undefined) return false

      const permissionRequest = mapApprovalRequest(notification)
      if (permissionRequest) {
        if (controller.signal.aborted) {
          await connection.respond(notification.requestIdRaw, { decision: 'decline' })
          return true
        }
        if (!callbacks?.onPermissionRequest) {
          await connection.respond(notification.requestIdRaw, { decision: 'decline' })
          return true
        }
        try {
          const decisionPromise = new Promise<CodexApprovalDecision>((resolve, reject) => {
            session.pendingApprovals.set(permissionRequest.requestId, { resolve, reject })
          })
          callbacks?.onPermissionRequest?.(permissionRequest)
          const decision = await decisionPromise
          await connection.respond(notification.requestIdRaw, { decision })
          return true
        } finally {
          session.pendingApprovals.delete(permissionRequest.requestId)
        }
      }

      await connection.respond(notification.requestIdRaw, {})
      return true
    }

    const isRelevantTurn = (params: Record<string, unknown>): boolean => {
      if (!activeTurnId) return true
      const turnId = readString(params.turnId) ?? readString(asRecord(params.turn)?.id)
      return !turnId || turnId === activeTurnId
    }

    while (!turnCompleted) {
      const notification = await connection.nextNotification()
      const { method, params } = notification

      if (await handleServerRequest(notification)) {
        continue
      }

      if (method === 'thread/started') {
        const startedThreadId = readString(asRecord(params.thread)?.id)
        if (startedThreadId) {
          session.threadId = startedThreadId
          emitThreadStarted(startedThreadId)
        }
        continue
      }

      if (!isRelevantTurn(params)) {
        continue
      }

      switch (method) {
        case 'item/started':
        case 'item/completed': {
          const rawItem = asRecord(params.item)
          if (!rawItem) break

          const itemId = readString(rawItem.id)
          const previous = itemId ? itemMap.get(itemId) : undefined
          const mapped = mapThreadItemFromAppServer(rawItem, previous)
          if (!mapped) break

          upsertItem(itemOrder, itemMap, mapped)
          callbacks?.onItemDelta?.(method === 'item/started' ? 'started' : 'completed', mapped)
          break
        }

        case 'item/agentMessage/delta': {
          const itemId = readString(params.itemId)
          const delta = readString(params.delta) ?? ''
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousText = previous?.type === 'agent_message' ? previous.text : ''
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'agent_message',
            text: `${previousText}${delta}`,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta': {
          const itemId = readString(params.itemId)
          const delta = readString(params.delta) ?? ''
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousText = previous?.type === 'reasoning' ? previous.text : ''
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'reasoning',
            text: `${previousText}${delta}`,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'item/commandExecution/outputDelta': {
          const itemId = readString(params.itemId)
          const delta = readString(params.delta) ?? ''
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousCommand = previous?.type === 'command_execution' ? previous : null
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'command_execution',
            command: previousCommand?.command ?? '',
            aggregatedOutput: `${previousCommand?.aggregatedOutput ?? ''}${delta}`,
            ...(previousCommand?.exitCode !== undefined ? { exitCode: previousCommand.exitCode } : {}),
            status: previousCommand?.status ?? 'in_progress',
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'turn/plan/updated': {
          const plan = Array.isArray(params.plan) ? params.plan : []
          if (plan.length === 0) break

          const todoId = activeTurnId ? `todo_${activeTurnId}` : 'todo_current'
          const todoItems = plan
            .map((entry) => {
              const step = asRecord(entry)
              const text = readString(step?.step)
              if (!text) return null
              return {
                text,
                completed: readString(step?.status) === 'completed',
              }
            })
            .filter((entry): entry is { text: string; completed: boolean } => entry !== null)

          if (todoItems.length === 0) break

          const updated: CodexThreadItem = {
            id: todoId,
            type: 'todo_list',
            items: todoItems,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'thread/tokenUsage/updated': {
          const nextUsage = mapUsageFromTokenUsage(params.tokenUsage ?? params)
          if (nextUsage) {
            usage = nextUsage
            callbacks?.onUsageDelta?.(nextUsage)
          }
          break
        }

        case 'error': {
          const willRetry = readBoolean(params.willRetry) ?? false
          if (willRetry) break
          throw new Error(extractTurnErrorMessage(params))
        }

        case 'turn/completed': {
          const completedTurn = asRecord(params.turn)
          const status = readString(completedTurn?.status) ?? 'completed'
          if (status === 'failed') {
            throw new Error(extractTurnErrorMessage(completedTurn?.error ?? params))
          }
          if (status === 'interrupted') {
            throw new Error('Codex run interrupted')
          }
          turnCompleted = true
          break
        }

        default:
          break
      }
    }

    const items = itemOrder
      .map((id) => itemMap.get(id))
      .filter((item): item is CodexThreadItem => Boolean(item))

    return {
      threadId: session.threadId,
      usage,
      items,
    }
  }

  async run(
    projectPath: string,
    request: CodexRunRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult> {
    const prompt = request.prompt.trim()
    const persistedImagePaths = request.images?.length ? persistImageAttachments(projectPath, request.images) : []
    const normalizedPrompt = prompt || (persistedImagePaths.length > 0 ? 'Please analyze the attached images.' : '')
    if (!normalizedPrompt) {
      throw new Error('Codex prompt is empty')
    }

    const session = this.ensureSession(
      projectPath,
      request.model,
      request.threadId,
      request.reasoningEffort,
      request.permissionPreset,
    )
    if (session.runningController) {
      throw new Error('Codex is already running for this project')
    }

    const controller = new AbortController()
    session.runningController = controller

    try {
      const permissionProfile = resolvePermissionProfile(session.permissionPreset)

      const streamed = await this.withAppServerConnection(session, controller.signal, async (connection) => {
        const resolvedThreadId = await this.resolveThread(connection, session, projectPath, permissionProfile)

        const turnStartResult = await connection.request(
          'turn/start',
          compactRecord({
            threadId: resolvedThreadId,
            input: [
              {
                type: 'text',
                text: normalizedPrompt,
                text_elements: [],
              },
              ...persistedImagePaths.map((path) => ({ type: 'localImage', path })),
            ],
            model: session.model,
            effort: session.modelReasoningEffort,
            approvalPolicy: permissionProfile.approvalPolicy,
            sandboxPolicy: this.buildTurnSandboxPolicy(projectPath, permissionProfile),
          }),
        )

        const turn = asRecord(turnStartResult.turn)
        const activeTurnId = readString(turn?.id)

        // Set up steer capability while turn is active
        session.activeTurnId = activeTurnId
        let steerSeq = 9000
        session.steerFn = async (text: string) => {
          steerSeq += 1
          await connection.request('turn/steer', {
            threadId: resolvedThreadId,
            input: [{ type: 'text', text }],
            expectedTurnId: activeTurnId,
          })
        }

        try {
          return await this.streamTurnEvents(connection, session, activeTurnId, controller, callbacks)
        } finally {
          session.activeTurnId = null
          session.steerFn = null
        }
      })

      return {
        threadId: streamed.threadId,
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        items: streamed.items,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Codex run interrupted')
      }
      throw error
    } finally {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      cleanupPersistedImageAttachments(persistedImagePaths)
      if (session.runningController === controller) {
        session.runningController = null
      }
    }
  }

  async steer(projectPath: string, input: string): Promise<void> {
    const session = this.sessions.get(projectPath)
    if (!session?.steerFn) {
      throw new Error('No active Codex turn to steer')
    }
    await session.steerFn(input)
  }

  async review(
    projectPath: string,
    request: CodexReviewRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult> {
    const session = this.ensureSession(
      projectPath,
      request.model,
      request.threadId,
      undefined,
      request.permissionPreset,
    )
    if (session.runningController) {
      throw new Error('Codex is already running for this project')
    }

    const controller = new AbortController()
    session.runningController = controller

    try {
      const permissionProfile = resolvePermissionProfile(session.permissionPreset)

      const streamed = await this.withAppServerConnection(session, controller.signal, async (connection) => {
        const resolvedThreadId = await this.resolveThread(connection, session, projectPath, permissionProfile)

        await connection.request('review/start', compactRecord({
          threadId: resolvedThreadId,
          delivery: 'inline',
          target: request.target,
        }))

        return this.streamTurnEvents(connection, session, null, controller, callbacks)
      })

      return {
        threadId: streamed.threadId,
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        items: streamed.items,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Codex run interrupted')
      }
      throw error
    } finally {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController === controller) {
        session.runningController = null
      }
    }
  }

  async compact(
    projectPath: string,
    request: CodexCompactRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult> {
    const session = this.ensureSession(
      projectPath,
      request.model,
      request.threadId,
      undefined,
      request.permissionPreset,
    )
    if (session.runningController) {
      throw new Error('Codex is already running for this project')
    }

    const controller = new AbortController()
    session.runningController = controller

    try {
      const permissionProfile = resolvePermissionProfile(session.permissionPreset)

      const streamed = await this.withAppServerConnection(session, controller.signal, async (connection) => {
        const resolvedThreadId = await this.resolveThread(connection, session, projectPath, permissionProfile)

        await connection.request('thread/compact/start', { threadId: resolvedThreadId })

        return this.streamTurnEvents(connection, session, null, controller, callbacks)
      })

      return {
        threadId: streamed.threadId,
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        items: streamed.items,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Codex run interrupted')
      }
      throw error
    } finally {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController === controller) {
        session.runningController = null
      }
    }
  }

  interrupt(projectPath: string): boolean {
    const session = this.sessions.get(projectPath)
    if (!session?.runningController) return false
    session.runningController.abort()
    return true
  }

  respondToPermission(
    projectPath: string,
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    _reason?: string,
  ): boolean {
    const session = this.sessions.get(projectPath)
    if (!session) return false
    const pending = session.pendingApprovals.get(requestId)
    if (!pending) return false

    session.pendingApprovals.delete(requestId)
    const decision: CodexApprovalDecision = allow
      ? (alwaysAllow ? 'acceptForSession' : 'accept')
      : 'decline'
    pending.resolve(decision)
    return true
  }

  reset(projectPath: string): void {
    const session = this.sessions.get(projectPath)
    if (!session) return
    this.rejectPendingApprovals(session, 'Codex run interrupted')
    if (session.runningController) session.runningController.abort()
    session.threadId = null
    session.runningController = null
    session.modelCache = null
  }

  setAuth(projectPath: string, request: CodexSetAuthRequest): CodexAuthStatus {
    const current = this.sessions.get(projectPath)
    const mode = request.mode
    const apiKey = mode === 'apiKey'
      ? normalizeApiKey(request.apiKey) ?? current?.apiKey
      : undefined

    if (mode === 'apiKey' && !resolveApiKey('apiKey', apiKey)) {
      throw new Error('API key mode requires apiKey or CODEX_API_KEY')
    }

    if (current) this.rejectPendingApprovals(current, 'Codex run interrupted')
    if (current?.runningController) current.runningController.abort()
    const recreated = this.createSession(
      projectPath,
      mode,
      apiKey,
      current?.model,
      current?.threadId ?? undefined,
      current?.modelReasoningEffort,
      current?.permissionPreset,
    )
    this.sessions.set(projectPath, recreated)
    return this.getAuthStatus(projectPath)
  }

  getAuthStatus(projectPath: string): CodexAuthStatus {
    const session = this.ensureSession(projectPath)
    return {
      mode: session.mode,
      resolvedMode: resolveMode(session.mode, session.apiKey),
      hasEnvApiKey: Boolean(normalizeApiKey(process.env.CODEX_API_KEY)),
      hasSessionApiKey: Boolean(normalizeApiKey(session.apiKey)),
      isRunning: Boolean(session.runningController),
    }
  }

  closeProject(projectPath: string): void {
    const session = this.sessions.get(projectPath)
    if (!session) return
    this.rejectPendingApprovals(session, 'Codex run interrupted')
    if (session.runningController) session.runningController.abort()
    this.sessions.delete(projectPath)
  }

  dispose(): void {
    for (const [projectPath] of this.sessions) {
      this.closeProject(projectPath)
    }
  }
}
