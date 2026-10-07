/**
 * Claude model catalog probe.
 *
 * The model list a harness can actually serve comes from the logged-in
 * credential of the process that runs it, so it has to be read from that
 * process (`query().supportedModels()`) rather than assumed. Remote nodes use
 * this instead of a hardcoded slug table; desktop uses it for the local path.
 */

import { query as sdkQuery, type Options, type Query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelOption } from '@superone/shared/agent-types'
import { resolveSdkClaudeBinary } from './resolve-sdk-binary'
import { applyRootPermissionGuard } from './root-permission-guard'
import type { ClaudeQueryFn } from './types'

/**
 * Prompt for metadata-only queries. A local slash command still yields
 * `system/init` and every control response, but never reaches the model —
 * a plain prompt such as 'hi' costs a full billed turn (~35k cache-write tokens).
 */
export const CLAUDE_METADATA_PROBE_PROMPT = '/help'

export interface ClaudeModelInfo {
  value: string
  resolvedModel?: string
  displayName: string
  description?: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
}

const MODEL_NAME_RE = /^(\w+ [\d.]+)(?:\s+with\s+(\w+)\s+context)?/

function extractModelName(descPrefix: string): string | null {
  const match = descPrefix.match(MODEL_NAME_RE)
  if (!match) return null
  return match[2] ? `${match[1]} ${match[2]}` : match[1]!
}

/** SDK model info → SuperOne `ModelOption` (concise name from the description). */
export function mapClaudeModelInfo(m: ClaudeModelInfo): ModelOption {
  const raw = m.description ?? ''
  const sepIdx = raw.indexOf('·')
  const descPrefix = sepIdx !== -1 ? raw.slice(0, sepIdx).trim() : ''
  const name = extractModelName(descPrefix) ?? m.displayName
  const base: ModelOption = { id: m.value, name, description: raw }
  if (m.resolvedModel) base.resolvedModel = m.resolvedModel
  if (m.supportsEffort) base.supportsEffort = true
  if (m.supportedEffortLevels?.length) {
    base.supportedEffortLevels = m.supportedEffortLevels as ModelOption['supportedEffortLevels']
  }
  if (m.supportsAdaptiveThinking) base.supportsAdaptiveThinking = true
  if (m.supportsFastMode) base.supportsFastMode = true
  if (m.supportsAutoMode) base.supportsAutoMode = true
  return base
}

/**
 * The catalog row that follows the model named in the user's Claude Code
 * settings. Its name and capabilities are a snapshot of whatever that setting
 * was at probe time, so a later CLI change silently diverges from what
 * SuperOne shows (model label, Auto eligibility). Sessions always pin a
 * concrete model instead.
 */
export const CLAUDE_CLI_DEFAULT_MODEL_ID = 'default'

/** SDK catalog → SuperOne options, without the CLI-settings `default` row. */
export function mapClaudeModelCatalog(models: ClaudeModelInfo[]): ModelOption[] {
  return models.filter((m) => m.value !== CLAUDE_CLI_DEFAULT_MODEL_ID).map(mapClaudeModelInfo)
}

/** A stored Claude model id, or null when it named the dropped CLI `default` row. */
export function explicitClaudeModelId(id: string | null | undefined): string | null {
  return id && id !== CLAUDE_CLI_DEFAULT_MODEL_ID ? id : null
}

export interface FetchClaudeModelsOptions {
  /** Project directory the probe runs in (settings / credentials scope). */
  cwd: string
  /** Harness binary; defaults to the Agent SDK bundled platform binary. */
  binaryPath?: string | null
  /** Env for the probe process (provider keys, base URL). */
  env?: Record<string, string | undefined>
  /** Effective uid for the root permission guard. Defaults to `process.getuid`. */
  uid?: number | null
  /** Injectable SDK entry (tests). */
  queryFn?: ClaudeQueryFn
  /** Give up after this long; a hung probe must not block resource discovery. */
  timeoutMs?: number
}

const DEFAULT_PROBE_TIMEOUT_MS = 20_000

/**
 * Ask the harness process which models it supports.
 * Returns `[]` on any failure — callers decide what to show instead.
 */
export async function fetchClaudeModels(opts: FetchClaudeModelsOptions): Promise<ModelOption[]> {
  const binaryPath = opts.binaryPath ?? resolveSdkClaudeBinary()
  // No tool can run with maxTurns 0, and permission-skipping options make the
  // process refuse to start under root — probe with a mode that always starts.
  const permissions = applyRootPermissionGuard({
    permissionMode: 'default',
    uid: opts.uid === undefined ? process.getuid?.() : opts.uid,
    env: opts.env ?? (process.env as Record<string, string | undefined>),
  })
  const options: Options = {
    cwd: opts.cwd,
    ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
    maxTurns: 0,
    permissionMode: permissions.permissionMode as Options['permissionMode'],
    persistSession: false,
    ...(opts.env ? { env: opts.env } : {}),
  }

  let q: Query | undefined
  try {
    q = (opts.queryFn ?? sdkQuery)({ prompt: CLAUDE_METADATA_PROBE_PROMPT, options }) as Query
    const models = await withTimeout(
      (async () => {
        await q!.initializationResult()
        return (await q!.supportedModels()) as ClaudeModelInfo[]
      })(),
      opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    )
    return mapClaudeModelCatalog(models)
  } catch {
    return []
  } finally {
    try {
      q?.close()
    } catch {
      /* probe process already gone */
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`claude model probe timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
