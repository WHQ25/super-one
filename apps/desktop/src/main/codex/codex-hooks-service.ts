import type {
  CodexHookEventName,
  CodexHookGroup,
  CodexHookHandlerType,
  CodexHookInfo,
  CodexHookSource,
  CodexHookTrustStatus,
} from '@superone/shared/agent-types'
import type { CodexExperimentService } from './codex-experiment-service'

const HOOK_EVENT_NAMES: readonly CodexHookEventName[] = [
  'preToolUse',
  'postToolUse',
  'permissionRequest',
  'preCompact',
  'postCompact',
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'stop',
]

const HOOK_HANDLER_TYPES: readonly CodexHookHandlerType[] = ['command', 'prompt', 'agent']

const HOOK_SOURCES: readonly CodexHookSource[] = ['user', 'project', 'managed', 'plugin']

const HOOK_TRUST_STATUSES: readonly CodexHookTrustStatus[] = ['trusted', 'untrusted']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const candidate = readString(value)
  return candidate && (allowed as readonly string[]).includes(candidate) ? candidate as T : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null)
}

function mapHook(raw: unknown): CodexHookInfo | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const key = readString(rec.key)
  const eventName = readEnum(rec.eventName, HOOK_EVENT_NAMES)
  const handlerType = readEnum(rec.handlerType, HOOK_HANDLER_TYPES)
  const sourcePath = readString(rec.sourcePath)
  if (!key || !eventName || !handlerType || !sourcePath) return null
  return {
    key,
    eventName,
    handlerType,
    matcher: readString(rec.matcher),
    command: readString(rec.command),
    timeoutSec: readNumber(rec.timeoutSec) ?? 0,
    statusMessage: readString(rec.statusMessage),
    sourcePath,
    source: readEnum(rec.source, HOOK_SOURCES) ?? 'unknown',
    pluginId: readString(rec.pluginId),
    displayOrder: readNumber(rec.displayOrder) ?? 0,
    enabled: readBoolean(rec.enabled) ?? false,
    isManaged: readBoolean(rec.isManaged) ?? false,
    trustStatus: readEnum(rec.trustStatus, HOOK_TRUST_STATUSES) ?? 'unknown',
  }
}

function mapGroup(raw: unknown): CodexHookGroup | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const cwd = readString(rec.cwd)
  if (!cwd) return null
  const hooks = Array.isArray(rec.hooks)
    ? rec.hooks.map(mapHook).filter((h): h is CodexHookInfo => h !== null)
    : []
  const warnings = readStringArray(rec.warnings)
  const errors = Array.isArray(rec.errors)
    ? rec.errors
        .map((e) => readString(asRecord(e)?.message) ?? readString(e))
        .filter((m): m is string => m !== null)
    : []
  return { cwd, hooks, warnings, errors }
}

export class CodexHooksService {
  constructor(private readonly codexService: CodexExperimentService) {}

  async list(projectPath: string, _opts?: { forceReload?: boolean }): Promise<CodexHookGroup[]> {
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('hooks/list', { cwds: projectPath ? [projectPath] : [] })
      const data = Array.isArray(result.data) ? result.data : []
      return data.map(mapGroup).filter((g): g is CodexHookGroup => g !== null)
    })
  }
}
