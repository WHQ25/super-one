/**
 * Electron-free Codex app-server admin helpers (auth/usage/plugins/marketplace).
 * Used by the node CLI; desktop keeps a richer pooled service.
 */

import { randomUUID } from 'node:crypto'
import type {
  CodexAccountLoginStartResult,
  CodexAccountStatus,
  CodexAccountUsage,
  CodexAuthStatus,
  CodexExternalAgentImportResult,
  CodexExternalAgentItem,
  CodexMcpOauthLoginResult,
  CodexMcpOauthLoginOptions,
  CodexRateLimitResetCredit,
  CodexRateLimitResetOutcome,
  CodexRateLimits,
  CodexRateLimitWindow,
  CodexSetAuthRequest,
} from '@superone/shared/agent-types'
import type { CodexAppServerHandle } from './app-server-client'
import { safePublicError } from './app-server-client'

export type CodexAuthMode = 'auto' | 'chatgpt' | 'apiKey'

export interface CodexProjectAuth {
  mode: CodexAuthMode
  apiKey?: string
}

export function normalizeApiKey(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function resolveMode(
  mode: CodexAuthMode,
  apiKey?: string | null,
): 'chatgpt' | 'apiKey' {
  if (mode === 'apiKey') return 'apiKey'
  if (mode === 'chatgpt') return 'chatgpt'
  // auto: prefer session/env API key when present
  if (normalizeApiKey(apiKey) || normalizeApiKey(process.env.CODEX_API_KEY)) return 'apiKey'
  return 'chatgpt'
}

export function getAuthStatus(
  auth: CodexProjectAuth,
  opts?: { isRunning?: boolean },
): CodexAuthStatus {
  return {
    mode: auth.mode,
    resolvedMode: resolveMode(auth.mode, auth.apiKey),
    hasEnvApiKey: Boolean(normalizeApiKey(process.env.CODEX_API_KEY)),
    hasSessionApiKey: Boolean(normalizeApiKey(auth.apiKey)),
    isRunning: opts?.isRunning ?? false,
  }
}

export function applySetAuth(
  current: CodexProjectAuth,
  request: CodexSetAuthRequest,
): CodexProjectAuth {
  const mode = request.mode
  const apiKey =
    mode === 'apiKey'
      ? normalizeApiKey(request.apiKey) ?? current.apiKey
      : undefined
  if (mode === 'apiKey' && !normalizeApiKey(apiKey) && !normalizeApiKey(process.env.CODEX_API_KEY)) {
    throw new Error('API key mode requires apiKey or CODEX_API_KEY')
  }
  return { mode, apiKey: normalizeApiKey(apiKey) }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseAccountAuthMode(value: unknown): CodexAccountStatus['authMode'] {
  switch (value) {
    case 'apiKey':
    case 'chatgpt':
    case 'chatgptAuthTokens':
    case 'agentIdentity':
    case 'personalAccessToken':
    case 'amazonBedrock':
    case 'bedrockApiKey':
      return value
    default:
      return null
  }
}

export function parseAccountStatus(raw: Record<string, unknown>): CodexAccountStatus {
  const account = asRecord(raw.account)
  return {
    signedIn: account !== null,
    authMode: parseAccountAuthMode(account?.type),
    email: readString(account?.email),
    planType: readString(account?.planType),
    requiresOpenaiAuth: readBoolean(raw.requiresOpenaiAuth) ?? false,
  }
}

export function parseAccountLoginStart(
  raw: Record<string, unknown>,
): CodexAccountLoginStartResult {
  const loginId = readString(raw.loginId)
  const type = readString(raw.type)
  if (!loginId || (type !== 'chatgpt' && type !== 'chatgptDeviceCode')) {
    throw new Error('Codex returned an invalid account login response')
  }
  const result: CodexAccountLoginStartResult = { type, loginId }
  const authUrl = readString(raw.authUrl)
  const verificationUrl = readString(raw.verificationUrl)
  const userCode = readString(raw.userCode)
  if (authUrl) result.authUrl = authUrl
  if (verificationUrl) result.verificationUrl = verificationUrl
  if (userCode) result.userCode = userCode
  return result
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNumericLike(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseRateLimitWindow(raw: unknown): CodexRateLimitWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const usedPercent = readFiniteNumber(rec.usedPercent)
  if (usedPercent === null) return null
  return {
    usedPercent,
    windowDurationMins: readFiniteNumber(rec.windowDurationMins),
    resetsAt: readFiniteNumber(rec.resetsAt),
  }
}

function parseResetCredit(raw: unknown): CodexRateLimitResetCredit | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const id = readString(rec.id)
  if (!id) return null
  const rawStatus = readString(rec.status)
  const status: CodexRateLimitResetCredit['status'] =
    rawStatus === 'available' || rawStatus === 'redeeming' || rawStatus === 'redeemed'
      ? rawStatus
      : 'unknown'
  return {
    id,
    status,
    title: readString(rec.title) ?? null,
    description: readString(rec.description) ?? null,
    expiresAt: readNumericLike(rec.expiresAt),
  }
}

export function parseRateLimits(raw: Record<string, unknown>): CodexRateLimits | null {
  const snapshot =
    raw.rateLimits && typeof raw.rateLimits === 'object'
      ? (raw.rateLimits as Record<string, unknown>)
      : raw
  const primary = parseRateLimitWindow(snapshot.primary)
  const secondary = parseRateLimitWindow(snapshot.secondary)
  if (!primary && !secondary) return null
  const resetCreditsRaw = raw.rateLimitResetCredits
  const resetSummary =
    resetCreditsRaw && typeof resetCreditsRaw === 'object'
      ? (resetCreditsRaw as Record<string, unknown>)
      : null
  const resetCredits = resetSummary ? readNumericLike(resetSummary.availableCount) : null
  const creditsRaw = resetSummary?.credits
  const resetCreditList = Array.isArray(creditsRaw)
    ? creditsRaw.map(parseResetCredit).filter((c): c is CodexRateLimitResetCredit => c !== null)
    : undefined
  return {
    primary,
    secondary,
    planType: readString(snapshot.planType),
    resetCredits,
    ...(resetCreditList && resetCreditList.length > 0 ? { resetCreditList } : {}),
  }
}

export function parseAccountUsage(raw: Record<string, unknown>): CodexAccountUsage | null {
  const summary =
    raw.summary && typeof raw.summary === 'object'
      ? (raw.summary as Record<string, unknown>)
      : raw
  const threadUsage = parseThreadUsage(raw.threadUsage)
  const usage: CodexAccountUsage = {
    lifetimeTokens: readNumericLike(summary.lifetimeTokens),
    peakDailyTokens: readNumericLike(summary.peakDailyTokens),
    longestRunningTurnSec: readNumericLike(summary.longestRunningTurnSec),
    currentStreakDays: readNumericLike(summary.currentStreakDays),
    longestStreakDays: readNumericLike(summary.longestStreakDays),
    ...(threadUsage ? { threadUsage } : {}),
  }
  const hasAny = Object.values(usage).some((v) => v !== null && v !== undefined)
  return hasAny ? usage : null
}

function parseThreadUsage(raw: unknown): CodexAccountUsage['threadUsage'] {
  const rec = asRecord(raw)
  const threadId = readString(rec?.threadId)
  const credits = readNumericLike(rec?.estimatedUsageCreditsMicros)
  if (!threadId || credits === null) return null
  const groups = Array.isArray(rec?.groups) ? rec.groups.flatMap((value) => {
    const group = asRecord(value)
    const groupCredits = readNumericLike(group?.estimatedUsageCreditsMicros)
    if (!group || groupCredits === null) return []
    return [{
      model: readString(group.model),
      reasoningEffort: readString(group.reasoningEffort),
      speed: readString(group.speed),
      estimatedUsageCreditsMicros: groupCredits,
      netNewInputTokens: readNumericLike(group.netNewInputTokens),
      cachedInputTokens: readNumericLike(group.cachedInputTokens),
      inputTokens: readNumericLike(group.inputTokens),
      outputTokens: readNumericLike(group.outputTokens),
      totalTokens: readNumericLike(group.totalTokens),
    }]
  }) : []
  return {
    threadId,
    estimatedUsageCreditsMicros: credits,
    estimatedUsageUsdMicros: readNumericLike(rec?.estimatedUsageUsdMicros),
    groups,
  }
}

export function parseExternalAgentItem(raw: unknown): CodexExternalAgentItem | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const itemType = readString(rec.itemType)
  if (!itemType) return null
  return {
    itemType,
    description: readString(rec.description) ?? '',
    cwd: readString(rec.cwd) ?? null,
    ...(rec.details !== undefined ? { details: rec.details } : {}),
  }
}

export function summarizeImportResults(raw: unknown): CodexExternalAgentImportResult {
  const results = Array.isArray(raw) ? raw : []
  let successCount = 0
  let failureCount = 0
  for (const result of results) {
    if (!result || typeof result !== 'object') continue
    const rec = result as Record<string, unknown>
    if (Array.isArray(rec.successes)) successCount += rec.successes.length
    if (Array.isArray(rec.failures)) failureCount += rec.failures.length
  }
  return { successCount, failureCount }
}

export async function readRateLimits(
  client: CodexAppServerHandle,
): Promise<CodexRateLimits | null> {
  try {
    const result = await client.request('account/rateLimits/read')
    return parseRateLimits(result)
  } catch (err) {
    throw safePublicError('account/rateLimits/read failed', err)
  }
}

export async function readAccountStatus(
  client: CodexAppServerHandle,
  refreshToken = false,
): Promise<CodexAccountStatus> {
  try {
    return parseAccountStatus(await client.request('account/read', { refreshToken }))
  } catch (err) {
    throw safePublicError('account/read failed', err)
  }
}

export async function startAccountLogin(
  client: CodexAppServerHandle,
  type: CodexAccountLoginStartResult['type'],
): Promise<CodexAccountLoginStartResult> {
  try {
    return parseAccountLoginStart(await client.request(
      'account/login/start',
      type === 'chatgpt'
        ? { type, useHostedLoginSuccessPage: true, appBrand: 'chatgpt' }
        : { type },
    ))
  } catch (err) {
    throw safePublicError('account/login/start failed', err)
  }
}

export async function cancelAccountLogin(
  client: CodexAppServerHandle,
  loginId: string,
): Promise<void> {
  try {
    await client.request('account/login/cancel', { loginId })
  } catch (err) {
    throw safePublicError('account/login/cancel failed', err)
  }
}

export async function logoutAccount(client: CodexAppServerHandle): Promise<void> {
  try {
    await client.request('account/logout')
  } catch (err) {
    throw safePublicError('account/logout failed', err)
  }
}

export async function readAccountUsage(
  client: CodexAppServerHandle,
  threadId?: string | null,
): Promise<CodexAccountUsage | null> {
  try {
    const result = await client.request('account/usage/read', threadId ? { threadId } : {})
    return parseAccountUsage(result)
  } catch (err) {
    throw safePublicError('account/usage/read failed', err)
  }
}

function parseResetOutcome(raw: Record<string, unknown>): CodexRateLimitResetOutcome {
  switch (readString(raw.outcome)) {
    case 'reset':
      return 'reset'
    case 'nothingToReset':
      return 'nothingToReset'
    case 'noCredit':
      return 'noCredit'
    case 'alreadyRedeemed':
      return 'alreadyRedeemed'
    default:
      return 'unknown'
  }
}

/** Redeem a ChatGPT rate-limit reset credit (Usage UI parity with desktop). */
export async function consumeRateLimitReset(
  client: CodexAppServerHandle,
  creditId?: string | null,
): Promise<CodexRateLimitResetOutcome> {
  try {
    const result = await client.request('account/rateLimitResetCredit/consume', {
      idempotencyKey: randomUUID(),
      ...(creditId ? { creditId } : {}),
    })
    return parseResetOutcome(result)
  } catch (err) {
    throw safePublicError('account/rateLimitResetCredit/consume failed', err)
  }
}

export async function loginMcpServerOauth(
  client: CodexAppServerHandle,
  serverName: string,
  openUrl?: (url: string) => void,
  timeoutMs = 180_000,
  options?: CodexMcpOauthLoginOptions,
): Promise<CodexMcpOauthLoginResult> {
  try {
    const res = await client.request('mcpServer/oauth/login', compactRecord({
      name: serverName,
      clientRegistration: options?.clientRegistration,
      threadId: options?.threadId,
      scopes: options?.scopes,
      timeoutSecs: options?.timeoutSecs,
    }))
    const authorizationUrl = readString(res.authorizationUrl)
    if (!authorizationUrl) return { success: false, error: 'Codex returned no authorization URL' }
    // Always return the URL so headless/CLI callers can surface it when openUrl
    // is not provided (desktop may open a browser via host-action).
    openUrl?.(authorizationUrl)
    const effectiveTimeoutMs = typeof options?.timeoutSecs === 'number' && options.timeoutSecs > 0
      ? options.timeoutSecs * 1_000
      : timeoutMs
    const deadline = Date.now() + effectiveTimeoutMs
    while (Date.now() < deadline) {
      const notif = await client.nextNotification(Math.min(1_000, deadline - Date.now()))
      if (!notif) continue
      if (
        notif.method === 'mcpServer/oauthLogin/completed' &&
        readString(notif.params.name) === serverName &&
        (!options?.threadId || readString(notif.params.threadId) === options.threadId)
      ) {
        return {
          success: readBoolean(notif.params.success) ?? false,
          error: readString(notif.params.error) ?? undefined,
          authorizationUrl,
        }
      }
    }
    return {
      success: false,
      error: 'Timed out waiting for authorization',
      authorizationUrl,
    }
  } catch (err) {
    return {
      success: false,
      error: safePublicError('mcpServer/oauth/login failed', err).message,
    }
  }
}

export async function detectExternalAgentConfig(
  client: CodexAppServerHandle,
  cwd: string,
): Promise<CodexExternalAgentItem[]> {
  try {
    const res = await client.request('externalAgentConfig/detect', {
      includeHome: true,
      cwds: [cwd],
    })
    const items = Array.isArray(res.items) ? res.items : []
    return items.map(parseExternalAgentItem).filter((i): i is CodexExternalAgentItem => i !== null)
  } catch {
    return []
  }
}

export async function importExternalAgentConfig(
  client: CodexAppServerHandle,
  items: CodexExternalAgentItem[],
  timeoutMs = 120_000,
): Promise<CodexExternalAgentImportResult | null> {
  if (items.length === 0) return { successCount: 0, failureCount: 0 }
  try {
    const res = await client.request('externalAgentConfig/import', {
      migrationItems: items,
      source: 'superone',
    })
    const importId = readString(res.importId)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const notif = await client.nextNotification(Math.min(1_000, deadline - Date.now()))
      if (!notif) continue
      if (
        notif.method === 'externalAgentConfig/import/completed' &&
        (!importId || readString(notif.params.importId) === importId)
      ) {
        return summarizeImportResults(notif.params.itemTypeResults)
      }
    }
    return { successCount: 0, failureCount: 0 }
  } catch {
    return null
  }
}

export interface CodexPluginInventoryRecord {
  key: string
  name: string
  marketplace: string
  marketplacePath: string
  sourcePath?: string
  installed: boolean
  enabled: boolean
}

export async function listPluginInventory(
  client: CodexAppServerHandle,
  projectPath?: string,
): Promise<CodexPluginInventoryRecord[]> {
  const result = await client.request(
    'plugin/list',
    projectPath ? { cwds: [projectPath] } : {},
  )
  const marketplaces = Array.isArray(result.marketplaces) ? result.marketplaces : []
  const records: CodexPluginInventoryRecord[] = []
  for (const rawMarketplace of marketplaces) {
    const marketplace = asRecord(rawMarketplace)
    if (!marketplace) continue
    const marketplaceName = readString(marketplace.name)
    const marketplacePath = readString(marketplace.path)
    if (!marketplaceName || !marketplacePath) continue
    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
    for (const rawPlugin of plugins) {
      const plugin = asRecord(rawPlugin)
      if (!plugin) continue
      const key = readString(plugin.id)
      const name = readString(plugin.name)
      const source = asRecord(plugin.source)
      const sourcePath = readString(source?.path) ?? undefined
      if (!key || !name) continue
      records.push({
        key,
        name,
        marketplace: marketplaceName,
        marketplacePath,
        sourcePath,
        installed: readBoolean(plugin.installed) ?? false,
        enabled: readBoolean(plugin.enabled) ?? false,
      })
    }
  }
  return records
}

export async function installPlugin(
  client: CodexAppServerHandle,
  marketplacePath: string,
  pluginName: string,
): Promise<void> {
  await client.request('plugin/install', { marketplacePath, pluginName })
}

export async function uninstallPlugin(
  client: CodexAppServerHandle,
  pluginId: string,
): Promise<void> {
  await client.request('plugin/uninstall', { pluginId })
}

export async function marketplaceAdd(
  client: CodexAppServerHandle,
  request: { source: string; refName?: string; sparsePaths?: string[] },
): Promise<{ marketplaceName: string; installedRoot: string; alreadyAdded: boolean }> {
  const source = request.source.trim()
  if (!source) throw new Error('Marketplace source cannot be empty')
  const result = await client.request('marketplace/add', compactRecord({
    source,
    refName: request.refName?.trim() || undefined,
    sparsePaths:
      request.sparsePaths && request.sparsePaths.length > 0 ? request.sparsePaths : undefined,
  }))
  return {
    marketplaceName: readString(result.marketplaceName) ?? '',
    installedRoot: readString(result.installedRoot) ?? '',
    alreadyAdded: readBoolean(result.alreadyAdded) ?? false,
  }
}

export async function marketplaceRemove(
  client: CodexAppServerHandle,
  marketplaceName: string,
): Promise<void> {
  const name = marketplaceName.trim()
  if (!name) throw new Error('marketplaceName cannot be empty')
  await client.request('marketplace/remove', { marketplaceName: name })
}

export async function marketplaceUpgrade(
  client: CodexAppServerHandle,
  marketplaceName?: string,
): Promise<{
  selectedMarketplaces: string[]
  upgradedRoots: string[]
  errors: Array<{ marketplaceName: string; message: string }>
}> {
  const name = marketplaceName?.trim() || undefined
  const result = await client.request(
    'marketplace/upgrade',
    name ? { marketplaceName: name } : {},
  )
  const errors = Array.isArray(result.errors)
    ? result.errors
        .map((raw) => {
          const rec = asRecord(raw)
          if (!rec) return null
          const marketplaceName =
            readString(rec.marketplaceName) ?? readString(rec.name)
          const message = readString(rec.message) ?? readString(rec.error)
          if (!marketplaceName || !message) return null
          return { marketplaceName, message }
        })
        .filter((e): e is { marketplaceName: string; message: string } => e !== null)
    : []
  return {
    selectedMarketplaces: Array.isArray(result.selectedMarketplaces)
      ? result.selectedMarketplaces.filter((s): s is string => typeof s === 'string')
      : [],
    upgradedRoots: Array.isArray(result.upgradedRoots)
      ? result.upgradedRoots.filter((s): s is string => typeof s === 'string')
      : [],
    errors,
  }
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}
