import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ANTIGRAVITY_AUTH_METHODS, type AntigravityAuthConfig, type AntigravityAuthMethod } from '@superone/shared/antigravity-auth'
import { decryptSecret, encryptSecretIfAvailable } from '../crypto/secret-store'
import { superoneHome } from '../superone-home'
import {
  ANTIGRAVITY_AUTH_BROWSER_MARKER,
  ANTIGRAVITY_AUTH_STDERR_PREFIX,
  ANTIGRAVITY_AUTH_STDOUT_PREFIX,
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  forwardAntigravityCallbackUrl,
  validateAntigravityOAuthUrl,
} from './antigravity-oauth-url'

export {
  ANTIGRAVITY_AUTH_BROWSER_MARKER,
  ANTIGRAVITY_AUTH_STDERR_PREFIX,
  ANTIGRAVITY_AUTH_STDOUT_PREFIX,
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  forwardAntigravityCallbackUrl,
  validateAntigravityOAuthUrl,
}

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

const GCP_PROJECT_PATTERN = /^[a-z][a-z0-9.:-]{4,61}[a-z0-9]$/i
const GCP_LOCATION_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/i

let prunedTempDirsThisProcess = false

export interface StoredAntigravityAuthConfig extends AntigravityAuthConfig {
  apiKey?: string
  email?: string
  oauthSignedIn?: boolean
}

export function resolveAntigravityRoot(customHome?: string): string { return join(customHome ?? superoneHome(), 'antigravity') }
export function resolveAntigravityProfileDir(customHome?: string): string { return join(resolveAntigravityRoot(customHome), 'profile') }
export function resolveAntigravityBrainRoots(customHome?: string, home = homedir()): string[] {
  const profileDir = resolveAntigravityProfileDir(customHome)
  const userGeminiDir = join(home, '.gemini')
  if (customHome) {
    return [
      join(profileDir, 'antigravity-acp', 'brain'),
      join(profileDir, 'brain'),
      join(userGeminiDir, 'antigravity-cli', 'brain'),
      join(userGeminiDir, 'antigravity', 'brain'),
    ]
  }
  return [
    join(userGeminiDir, 'antigravity-cli', 'brain'),
    join(userGeminiDir, 'antigravity', 'brain'),
    join(profileDir, 'antigravity-acp', 'brain'),
    join(profileDir, 'brain'),
  ]
}
export function resolveAntigravityTempParentDir(customHome?: string): string { return join(resolveAntigravityRoot(customHome), 'tmp') }
export function resolveAntigravityAuthConfigPath(customHome?: string): string { return join(resolveAntigravityRoot(customHome), 'auth-config.json') }
export function resolveAntigravityTokenPath(customHome?: string): string { return join(resolveAntigravityProfileDir(customHome), 'oauth_creds.json') }
export function resolveLegacyAntigravityTokenPath(customHome?: string): string { return join(resolveAntigravityProfileDir(customHome), 'antigravity-acp', 'acp_token.json') }
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
    const oauthSignedIn = typeof raw.oauthSignedIn === 'boolean' ? raw.oauthSignedIn : undefined
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
      ...(oauthSignedIn !== undefined ? { oauthSignedIn } : {}),
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
    oauthSignedIn?: boolean
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
  const nextOauthSignedIn = input.oauthSignedIn !== undefined ? input.oauthSignedIn : prev.oauthSignedIn

  const root = resolveAntigravityRoot(customHome)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const configPath = resolveAntigravityAuthConfigPath(customHome)
  const payload = {
    authMethod: input.authMethod,
    ...(gcpProject ? { gcpProject } : {}),
    ...(gcpLocation ? { gcpLocation } : {}),
    ...(nextEmail ? { email: nextEmail } : {}),
    ...(nextOauthSignedIn !== undefined ? { oauthSignedIn: nextOauthSignedIn } : {}),
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

function hasValidTokenFile(tokenPath: string): boolean {
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

export function hasStoredAntigravityOAuthToken(customHome?: string): boolean {
  if (readAntigravityAuthConfig(customHome).oauthSignedIn === true) return true
  if (
    hasValidTokenFile(resolveAntigravityTokenPath(customHome)) ||
    hasValidTokenFile(resolveLegacyAntigravityTokenPath(customHome))
  ) {
    return true
  }
  if (!customHome) {
    return hasValidTokenFile(join(homedir(), '.gemini', 'oauth_creds.json'))
  }
  return false
}

export function clearAntigravityOAuthToken(customHome?: string): void {
  for (const tokenPath of [
    resolveAntigravityTokenPath(customHome),
    resolveLegacyAntigravityTokenPath(customHome),
  ]) {
    try {
      rmSync(tokenPath, { force: true })
    } catch {
      void 0
    }
  }
  try {
    const prev = readAntigravityAuthConfig(customHome)
    if (prev.email || prev.oauthSignedIn) {
      writeAntigravityAuthConfig(
        { authMethod: prev.authMethod, clearEmail: true, oauthSignedIn: false },
        customHome,
      )
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

function ensureBrowserHelperScript(rootDir: string): string {
  const binDir = join(rootDir, 'bin')
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

const STALE_TEMP_DIR_MAX_AGE_MS = 6 * 60 * 60 * 1000

function createIsolatedProcessTempDir(customHome?: string): string {
  const parent = resolveAntigravityTempParentDir(customHome)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  if (!prunedTempDirsThisProcess) {
    prunedTempDirsThisProcess = true
    const now = Date.now()
    try {
      for (const entry of readdirSync(parent)) {
        if (!entry.startsWith('run-')) continue
        const entryPath = join(parent, entry)
        try {
          if (now - statSync(entryPath).mtimeMs > STALE_TEMP_DIR_MAX_AGE_MS) {
            rmSync(entryPath, { recursive: true, force: true })
          }
        } catch {
          void 0
        }
      }
    } catch {
      void 0
    }
  }
  const runDir = join(parent, `run-${randomUUID().slice(0, 8)}`)
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

export interface AntigravitySpawnContext {
  authConfig: StoredAntigravityAuthConfig
  baseEnv: Record<string, string>
  extraEnv: Record<string, string>
  cleanup: () => void
}

export function prepareAntigravitySpawnContext(opts: {
  harnessPath?: string
  customHome?: string
  extraEnv?: Record<string, string>
} = {}): AntigravitySpawnContext {
  const authConfig = readAntigravityAuthConfig(opts.customHome)
  const rootDir = resolveAntigravityRoot(opts.customHome)
  mkdirSync(rootDir, { recursive: true, mode: 0o700 })
  const helperPath = ensureBrowserHelperScript(rootDir)
  const runTempDir = createIsolatedProcessTempDir(opts.customHome)

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
    BROWSER: `${quoteArg(process.execPath)} ${quoteArg(helperPath)}`,
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
