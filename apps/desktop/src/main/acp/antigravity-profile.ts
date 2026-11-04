import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import * as http from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ANTIGRAVITY_AUTH_METHODS, type AntigravityAuthConfig, type AntigravityAuthMethod } from '@superone/shared/antigravity-auth'
import { decryptSecret, encryptSecretIfAvailable } from '../crypto/secret-store'
import { superoneHome } from '../superone-home'
import { ensureAntigravityAutoBootstrap } from './antigravity-auto-bootstrap'

export const ANTIGRAVITY_AUTH_STDOUT_PREFIX = 'Open the following link to authenticate the ACP server: '
export const ANTIGRAVITY_AUTH_BROWSER_MARKER = '__SUPERONE_ANTIGRAVITY_AUTH_URL__'

const STRIPPED_ENV_KEYS = new Set([
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION', 'GOOGLE_CLOUD_QUOTA_PROJECT', 'GOOGLE_GENAI_USE_VERTEXAI', 'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'AGY_ACP_CCPA_PROJECT', 'AGY_ACP_ENABLE_OAUTH', 'GEMINI_HOME',
  'AGY_ACP_FORCE_FILE_STORAGE', 'ANTIGRAVITY_HARNESS_PATH', 'BROWSER', 'PYTHONUNBUFFERED',
  'ELECTRON_RUN_AS_NODE', '__PYVENV_LAUNCHER__',
])

const LINUX_SYSTEM_CA_BUNDLE_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem', '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem', '/etc/ssl/cert.pem',
]

const USER_SKILL_PATHS = [
  ['config', 'skills'],
  ['config', 'plugins'],
  ['antigravity-cli', 'skills'],
  ['antigravity-cli', 'builtin'],
] as const

const GCP_PROJECT_PATTERN = /^[a-z][a-z0-9.:-]{4,61}[a-z0-9]$/i
const GCP_LOCATION_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/i
const LOOPBACK_REDIRECT_URI_PATTERN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/$/

let prunedTempDirsThisProcess = false

export interface StoredAntigravityAuthConfig extends AntigravityAuthConfig {
  apiKey?: string
  email?: string
}

export function resolveAntigravityRoot(customHome?: string): string { return join(customHome ?? superoneHome(), 'antigravity') }
export function resolveAntigravityProfileDir(customHome?: string): string { return join(resolveAntigravityRoot(customHome), 'profile') }
export function resolveAntigravityTempParentDir(customHome?: string): string { return join(resolveAntigravityRoot(customHome), 'tmp') }
export function resolveAntigravityAuthConfigPath(customHome?: string): string { return join(resolveAntigravityRoot(customHome), 'auth-config.json') }
export function resolveAntigravityTokenPath(customHome?: string): string { return join(resolveAntigravityProfileDir(customHome), 'antigravity-acp', 'acp_token.json') }
export { resolveAntigravityTokenPath as antigravityTokenFilePath }

function isValidAuthMethod(value: unknown): value is AntigravityAuthMethod {
  return typeof value === 'string' && (ANTIGRAVITY_AUTH_METHODS as readonly string[]).includes(value)
}

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function readAntigravityAuthConfig(customHome?: string): StoredAntigravityAuthConfig {
  const path = resolveAntigravityAuthConfigPath(customHome)
  if (!existsSync(path)) {
    const envKey = trimNonEmpty(process.env.SUPERONE_ANTIGRAVITY_API_KEY)
    return {
      authMethod: 'oauth-personal',
      hasApiKey: Boolean(envKey),
      ...(envKey ? { apiKey: envKey } : {}),
    }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const authMethod = isValidAuthMethod(raw.authMethod) ? raw.authMethod : 'oauth-personal'
    const gcpProject = trimNonEmpty(raw.gcpProject)
    const gcpLocation = trimNonEmpty(raw.gcpLocation)
    const email = trimNonEmpty(raw.email)
    const decrypted =
      typeof raw.encryptedApiKey === 'string' && raw.encryptedApiKey
        ? decryptSecret(raw.encryptedApiKey).trim()
        : ''
    const apiKey = decrypted || trimNonEmpty(process.env.SUPERONE_ANTIGRAVITY_API_KEY)
    return {
      authMethod,
      ...(gcpProject ? { gcpProject } : {}),
      ...(gcpLocation ? { gcpLocation } : {}),
      ...(email ? { email } : {}),
      hasApiKey: Boolean(apiKey),
      ...(apiKey ? { apiKey } : {}),
    }
  } catch {
    return { authMethod: 'oauth-personal', hasApiKey: false }
  }
}

export function writeAntigravityAuthConfig(
  input: {
    authMethod: AntigravityAuthMethod
    apiKey?: string
    clearApiKey?: boolean
    gcpProject?: string
    gcpLocation?: string
    email?: string
    clearEmail?: boolean
  },
  customHome?: string,
): StoredAntigravityAuthConfig {
  if (!isValidAuthMethod(input.authMethod)) {
    throw new Error(`Unsupported Antigravity authentication method: ${String(input.authMethod)}`)
  }
  const prev = readAntigravityAuthConfig(customHome)
  const gcpProject = input.gcpProject !== undefined ? trimNonEmpty(input.gcpProject) : prev.gcpProject
  const gcpLocation = input.gcpLocation !== undefined ? trimNonEmpty(input.gcpLocation) : prev.gcpLocation

  if (gcpProject && !GCP_PROJECT_PATTERN.test(gcpProject)) {
    throw new Error('Enter a valid Google Cloud project ID')
  }
  if (gcpLocation && !GCP_LOCATION_PATTERN.test(gcpLocation)) {
    throw new Error('Enter a valid Google Cloud location (for example us-central1 or global)')
  }

  const nextApiKey = input.clearApiKey ? undefined : (trimNonEmpty(input.apiKey) ?? prev.apiKey)
  const nextEmail = input.clearEmail ? undefined : (trimNonEmpty(input.email) ?? prev.email)

  const root = resolveAntigravityRoot(customHome)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const configPath = resolveAntigravityAuthConfigPath(customHome)
  const payload = {
    authMethod: input.authMethod,
    ...(gcpProject ? { gcpProject } : {}),
    ...(gcpLocation ? { gcpLocation } : {}),
    ...(nextEmail ? { email: nextEmail } : {}),
    ...(nextApiKey ? { encryptedApiKey: encryptSecretIfAvailable(nextApiKey) } : {}),
  }
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(configPath, 0o600)
  return readAntigravityAuthConfig(customHome)
}

export function writeAntigravityAuthEmail(email: string, customHome?: string): void {
  const trimmed = email.trim()
  if (!trimmed) return
  const prev = readAntigravityAuthConfig(customHome)
  if (prev.email === trimmed) return
  try {
    writeAntigravityAuthConfig({ authMethod: prev.authMethod, email: trimmed }, customHome)
  } catch {
    void 0
  }
}

export function hasStoredAntigravityOAuthToken(customHome?: string): boolean {
  const tokenPath = resolveAntigravityTokenPath(customHome)
  if (!existsSync(tokenPath)) return false
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
      refresh_token?: unknown
      access_token?: unknown
    }
    return (
      (typeof parsed.refresh_token === 'string' && parsed.refresh_token.trim().length > 0) ||
      (typeof parsed.access_token === 'string' && parsed.access_token.trim().length > 0)
    )
  } catch {
    return false
  }
}

export function clearAntigravityOAuthToken(customHome?: string): void {
  const tokenPath = resolveAntigravityTokenPath(customHome)
  try {
    rmSync(tokenPath, { force: true })
  } catch {
    void 0
  }
  try {
    const prev = readAntigravityAuthConfig(customHome)
    if (prev.email) {
      writeAntigravityAuthConfig({ authMethod: prev.authMethod, clearEmail: true }, customHome)
    }
  } catch {
    void 0
  }
}

export function isAntigravityAuthSatisfied(customHome?: string): boolean {
  const cfg = readAntigravityAuthConfig(customHome)
  switch (cfg.authMethod) {
    case 'gemini-api-key':
      return Boolean(cfg.apiKey)
    case 'agent-platform':
      return Boolean(cfg.apiKey || (cfg.gcpProject && cfg.gcpLocation))
    case 'oauth-business':
      return Boolean(cfg.gcpProject && cfg.gcpLocation && hasStoredAntigravityOAuthToken(customHome))
    case 'oauth-personal':
      return hasStoredAntigravityOAuthToken(customHome)
  }
}

function linkUserSkills(geminiHomeDir: string): void {
  const userGeminiRoot = join(homedir(), '.gemini')
  for (const parts of USER_SKILL_PATHS) {
    const source = join(userGeminiRoot, ...parts)
    const target = join(geminiHomeDir, ...parts)
    try {
      const sourceExists = existsSync(source) && statSync(source).isDirectory()
      try {
        const dstStat = lstatSync(target)
        if (!dstStat.isSymbolicLink()) continue
        rmSync(target, { force: true })
      } catch {
        void 0
      }
      if (!sourceExists) continue
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      void 0
    }
  }
}

function ensureBrowserHelperScript(geminiHomeDir: string): string {
  const binDir = join(geminiHomeDir, 'bin')
  const helperPath = join(binDir, 'open-auth-url.cjs')
  mkdirSync(binDir, { recursive: true, mode: 0o700 })
  const script = [
    `const url = process.argv[2] ?? '';`,
    `process.stderr.write(${JSON.stringify(ANTIGRAVITY_AUTH_BROWSER_MARKER)} + url + '\\n');`,
  ].join('\n')
  writeFileSync(helperPath, `${script}\n`, { mode: 0o700 })
  if (process.platform !== 'win32') {
    chmodSync(helperPath, 0o700)
  }
  return helperPath
}

function ensureProfileSettings(geminiHomeDir: string, cfg: StoredAntigravityAuthConfig): void {
  const settingsDir = join(geminiHomeDir, 'antigravity-acp')
  const settingsPath = join(settingsDir, 'settings.json')
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 })
  const payload = {
    auth: { type: cfg.authMethod },
    ...(cfg.gcpProject || cfg.gcpLocation
      ? {
          gcp: {
            ...(cfg.gcpProject ? { project: cfg.gcpProject } : {}),
            ...(cfg.gcpLocation ? { location: cfg.gcpLocation } : {}),
          },
        }
      : {}),
  }
  writeFileSync(settingsPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') {
    chmodSync(settingsPath, 0o600)
  }
}

function createIsolatedProcessTempDir(customHome?: string): string {
  const parent = resolveAntigravityTempParentDir(customHome)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  if (!prunedTempDirsThisProcess) {
    prunedTempDirsThisProcess = true
    try {
      for (const entry of readdirSync(parent)) {
        if (entry.startsWith('run-')) {
          rmSync(join(parent, entry), { recursive: true, force: true })
        }
      }
    } catch {
      void 0
    }
  }
  const runDir = join(parent, `run-${randomUUID()}`)
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  return runDir
}

function resolveLinuxCaBundle(): string | undefined {
  if (process.platform !== 'linux') return undefined
  for (const candidate of LINUX_SYSTEM_CA_BUNDLE_PATHS) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    } catch {
      void 0
    }
  }
  return undefined
}

export function validateAntigravityOAuthUrl(rawUrl: string): {
  authUrl: string
  redirectUri: string
  state: string
} {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error('Antigravity returned an invalid Google OAuth URL')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'accounts.google.com' ||
    parsed.pathname !== '/o/oauth2/v2/auth' ||
    parsed.searchParams.get('response_type') !== 'code'
  ) {
    throw new Error('Antigravity returned an unexpected Google OAuth endpoint')
  }
  const state = parsed.searchParams.get('state')?.trim() ?? ''
  if (!state) {
    throw new Error('Antigravity Google OAuth URL is missing state')
  }
  const redirectUri = parsed.searchParams.get('redirect_uri')?.trim() ?? ''
  const match = LOOPBACK_REDIRECT_URI_PATTERN.exec(redirectUri)
  const port = match?.[1] ? Number(match[1]) : NaN
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Antigravity Google OAuth URL has an invalid loopback redirect URI')
  }
  return { authUrl: parsed.toString(), redirectUri, state }
}

export function extractAntigravityAuthUrlFromStdoutLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, '')
  if (!trimmed.startsWith(ANTIGRAVITY_AUTH_STDOUT_PREFIX)) return null
  const raw = trimmed.slice(ANTIGRAVITY_AUTH_STDOUT_PREFIX.length).trim()
  return raw || null
}

export function extractAntigravityAuthUrlsFromStderrChunk(chunk: string): string[] {
  const urls: string[] = []
  for (const line of chunk.split(/\r?\n/)) {
    const idx = line.indexOf(ANTIGRAVITY_AUTH_BROWSER_MARKER)
    if (idx < 0) continue
    const raw = line.slice(idx + ANTIGRAVITY_AUTH_BROWSER_MARKER.length).trim()
    if (raw) urls.push(raw)
  }
  return urls
}

export interface AntigravitySpawnContext {
  authConfig: StoredAntigravityAuthConfig
  baseEnv: Record<string, string>
  extraEnv: Record<string, string>
  cleanup: () => void
}

export function prepareAntigravitySpawnContext(opts: {
  harnessPath: string
  customHome?: string
  extraEnv?: Record<string, string>
}): AntigravitySpawnContext {
  const authConfig = readAntigravityAuthConfig(opts.customHome)
  const geminiHomeDir = resolveAntigravityProfileDir(opts.customHome)
  mkdirSync(geminiHomeDir, { recursive: true, mode: 0o700 })
  linkUserSkills(geminiHomeDir)
  ensureProfileSettings(geminiHomeDir, authConfig)
  const helperPath = ensureBrowserHelperScript(geminiHomeDir)
  const runTempDir = createIsolatedProcessTempDir(opts.customHome)
  const autoBootstrap = ensureAntigravityAutoBootstrap(
    resolveAntigravityRoot(opts.customHome),
    opts.harnessPath,
  )

  const preserveAdc = authConfig.authMethod === 'agent-platform' && !authConfig.apiKey
  const baseEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (preserveAdc && upper === 'GOOGLE_APPLICATION_CREDENTIALS') {
      baseEnv[key] = value
      continue
    }
    if (STRIPPED_ENV_KEYS.has(upper)) continue
    baseEnv[key] = value
  }

  const quoteArg = (val: string) =>
    process.platform === 'win32'
      ? `"${val.replaceAll('"', '""')}"`
      : `'${val.replaceAll("'", `'\\''`)}'`

  const extraEnv: Record<string, string> = {
    ...(opts.extraEnv ?? {}),
    GEMINI_HOME: geminiHomeDir,
    AGY_ACP_FORCE_FILE_STORAGE: '1',
    ANTIGRAVITY_HARNESS_PATH: opts.harnessPath,
    __PYVENV_LAUNCHER__: autoBootstrap.pyvenvLauncherPath,
    BROWSER: `${quoteArg(process.execPath)} ${quoteArg(helperPath)}`,
    PYTHONUNBUFFERED: '1',
    ELECTRON_RUN_AS_NODE: '1',
    TMPDIR: runTempDir,
    TEMP: runTempDir,
    TMP: runTempDir,
  }

  if (!baseEnv.SSL_CERT_FILE && !baseEnv.SSL_CERT_DIR) {
    const caBundle = resolveLinuxCaBundle()
    if (caBundle) extraEnv.SSL_CERT_FILE = caBundle
  }

  if (authConfig.authMethod === 'gemini-api-key' && authConfig.apiKey) {
    extraEnv.GEMINI_API_KEY = authConfig.apiKey
  } else if (authConfig.authMethod === 'agent-platform') {
    extraEnv.GOOGLE_GENAI_USE_VERTEXAI = 'true'
    if (authConfig.apiKey) {
      extraEnv.GOOGLE_API_KEY = authConfig.apiKey
    }
    if (authConfig.gcpProject) extraEnv.GOOGLE_CLOUD_PROJECT = authConfig.gcpProject
    if (authConfig.gcpLocation) extraEnv.GOOGLE_CLOUD_LOCATION = authConfig.gcpLocation
  } else if (authConfig.authMethod === 'oauth-business') {
    if (authConfig.gcpProject) extraEnv.GOOGLE_CLOUD_PROJECT = authConfig.gcpProject
    if (authConfig.gcpLocation) extraEnv.GOOGLE_CLOUD_LOCATION = authConfig.gcpLocation
  }

  let cleaned = false
  return {
    authConfig,
    baseEnv,
    extraEnv,
    cleanup: () => {
      if (cleaned) return
      cleaned = true
      try {
        rmSync(runTempDir, { recursive: true, force: true })
      } catch {
        void 0
      }
    },
  }
}

export async function forwardAntigravityCallbackUrl(
  rawCallbackUrl: string,
  pending: { redirectUri: string; state: string },
): Promise<void> {
  const trimmed = rawCallbackUrl.trim()
  if (!trimmed || trimmed.length > 4096) {
    throw new Error('Paste the complete localhost callback URL from the browser address bar')
  }
  let callbackUrl: URL
  let expectedRedirect: URL
  try {
    callbackUrl = new URL(trimmed)
    expectedRedirect = new URL(pending.redirectUri)
  } catch {
    throw new Error('Invalid localhost callback URL')
  }
  if (
    callbackUrl.origin !== expectedRedirect.origin ||
    callbackUrl.pathname !== expectedRedirect.pathname ||
    callbackUrl.username !== '' ||
    callbackUrl.password !== ''
  ) {
    throw new Error(
      'Callback URL does not match the active Antigravity login attempt. Use the URL from the current browser tab.',
    )
  }
  const state = callbackUrl.searchParams.get('state') ?? ''
  const code = callbackUrl.searchParams.get('code')?.trim() ?? ''
  const oauthError = callbackUrl.searchParams.get('error')?.trim() ?? ''
  if (state !== pending.state || (!code && !oauthError)) {
    throw new Error('Callback URL is missing the expected state or authorization code')
  }

  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        protocol: callbackUrl.protocol,
        hostname: callbackUrl.hostname,
        port: callbackUrl.port,
        path: `${callbackUrl.pathname}${callbackUrl.search}`,
        method: 'GET',
        agent: false,
        headers: { Connection: 'close' },
      },
      (res) => {
        res.resume()
        res.once('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve()
          } else {
            reject(
              new Error(`Antigravity rejected the OAuth callback (HTTP ${res.statusCode ?? 0})`),
            )
          }
        })
      },
    )
    req.setTimeout(5000, () => {
      req.destroy(new Error('Timed out delivering the OAuth callback to Antigravity'))
    })
    req.once('error', (err) => {
      reject(new Error(`Failed to deliver OAuth callback to Antigravity: ${err.message}`))
    })
    req.end()
  })
}
