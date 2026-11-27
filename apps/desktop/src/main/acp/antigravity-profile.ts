import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  antigravityAccountStore,
  resolveAntigravityRoot,
  type ResolvedAntigravityAccount,
} from './antigravity-account-store'
import {
  ANTIGRAVITY_AUTH_BROWSER_MARKER,
  ANTIGRAVITY_AUTH_STDERR_PREFIX,
  ANTIGRAVITY_AUTH_STDOUT_PREFIX,
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  forwardAntigravityCallbackUrl,
  validateAntigravityLoginCodeResponse,
  validateAntigravityOAuthUrl,
} from './antigravity-oauth-url'

export * from './antigravity-account-store'
export {
  ANTIGRAVITY_AUTH_BROWSER_MARKER,
  ANTIGRAVITY_AUTH_STDERR_PREFIX,
  ANTIGRAVITY_AUTH_STDOUT_PREFIX,
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  forwardAntigravityCallbackUrl,
  validateAntigravityLoginCodeResponse,
  validateAntigravityOAuthUrl,
}

const STRIPPED_ENV_KEYS = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'AGY_ACP_CCPA_PROJECT',
  'AGY_ACP_ENABLE_OAUTH',
  'GEMINI_HOME',
  'AGY_ACP_FORCE_FILE_STORAGE',
  'AGY_CLI_DISABLE_AUTO_UPDATE',
  'ANTIGRAVITY_HARNESS_PATH',
  'BROWSER',
  'PYTHONUNBUFFERED',
  'ELECTRON_RUN_AS_NODE',
  'CHROME_CRASHPAD_PIPE_NAME',
  '__PYVENV_LAUNCHER__',
])

const LINUX_SYSTEM_CA_BUNDLE_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
  '/etc/ssl/cert.pem',
]

const STALE_TEMP_DIR_MAX_AGE_MS = 6 * 60 * 60 * 1000
let prunedTempDirsThisProcess = false

export interface AntigravitySpawnContext {
  account: ResolvedAntigravityAccount
  extraArgs: string[]
  geminiDir: string | null
  baseEnv: Record<string, string>
  extraEnv: Record<string, string>
  cleanup: () => void
}

export function resolveAntigravityTempParentDir(customHome?: string): string {
  return join(resolveAntigravityRoot(customHome), 'tmp')
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
  if (process.platform !== 'win32') chmodSync(helperPath, 0o700)
  return helperPath
}

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

function linkUserGeminiConfigIntoProfile(profileDir: string, home = homedir()): void {
  const userGemini = join(home, '.gemini')
  if (!existsSync(userGemini)) return
  const dirPairs: Array<[string, string]> = [
    [join(profileDir, 'skills'), join(userGemini, 'skills')],
    [join(profileDir, 'antigravity', 'skills'), join(userGemini, 'antigravity', 'skills')],
  ]
  const dirType = process.platform === 'win32' ? 'junction' : 'dir'
  for (const [linkPath, targetPath] of dirPairs) {
    try {
      if (!existsSync(targetPath) || existsSync(linkPath)) continue
      mkdirSync(dirname(linkPath), { recursive: true, mode: 0o700 })
      symlinkSync(targetPath, linkPath, dirType)
    } catch {
      void 0
    }
  }
  const fileSegments: Array<string[]> = [['AGENTS.md'], ['GEMINI.md'], ['config', 'skills.json']]
  for (const segs of fileSegments) {
    const src = join(userGemini, ...segs)
    const dst = join(profileDir, ...segs)
    try {
      if (!existsSync(src)) continue
      mkdirSync(dirname(dst), { recursive: true, mode: 0o700 })
      if (process.platform === 'win32') {
        copyFileSync(src, dst)
      } else {
        try {
          const st = lstatSync(dst)
          if (st.isSymbolicLink() && resolve(dirname(dst), readlinkSync(dst)) === src) continue
          if (st.isSymbolicLink()) unlinkSync(dst)
          else continue
        } catch {
          void 0
        }
        symlinkSync(src, dst, 'file')
      }
    } catch {
      void 0
    }
  }
}

function writeProfileSettingsFile(profileDir: string, account: ResolvedAntigravityAccount): void {
  const acpDir = join(profileDir, 'antigravity-acp')
  mkdirSync(acpDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(acpDir, 0o700)
  const gcp = {
    ...(account.gcpProject ? { project: account.gcpProject } : {}),
    ...(account.gcpLocation ? { location: account.gcpLocation } : {}),
  }
  const payload = {
    auth: { type: account.authMethod },
    ...(Object.keys(gcp).length > 0 ? { gcp } : {}),
  }
  writeFileSync(join(acpDir, 'settings.json'), `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  })
}

export function prepareAntigravitySpawnContext(opts: {
  accountId?: string | null
  customHome?: string
  extraEnv?: Record<string, string>
} = {}): AntigravitySpawnContext {
  const store = antigravityAccountStore(opts.customHome)
  const account = store.get(opts.accountId)
  const rootDir = resolveAntigravityRoot(opts.customHome)
  mkdirSync(rootDir, { recursive: true, mode: 0o700 })
  const helperPath = ensureBrowserHelperScript(rootDir)
  const runTempDir = createIsolatedProcessTempDir(opts.customHome)

  const preserveAdc = account.authMethod === 'agent-platform' && !account.apiKey
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
    AGY_CLI_DISABLE_AUTO_UPDATE: '1',
    TMPDIR: runTempDir,
    TEMP: runTempDir,
    TMP: runTempDir,
  }

  if (!baseEnv.SSL_CERT_FILE && !baseEnv.SSL_CERT_DIR) {
    const caBundle = resolveLinuxCaBundle()
    if (caBundle) extraEnv.SSL_CERT_FILE = caBundle
  }

  const extraArgs: string[] = []
  let geminiDir: string | null = null

  if (account.profileDir) {
    mkdirSync(account.profileDir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') chmodSync(account.profileDir, 0o700)
    writeProfileSettingsFile(account.profileDir, account)
    linkUserGeminiConfigIntoProfile(account.profileDir)
    geminiDir = account.profileDir
    extraArgs.push('--gemini-dir', account.profileDir, '--app-data-dir', 'antigravity-acp')
    extraEnv.GEMINI_HOME = account.profileDir
    extraEnv.AGY_ACP_FORCE_FILE_STORAGE = '1'
    if (account.authMethod === 'oauth-personal') {
      extraEnv.SSH_CONNECTION = baseEnv.SSH_CONNECTION || '127.0.0.1 0 127.0.0.1 0'
    }
  }

  if (account.authMethod === 'gemini-api-key' && account.apiKey) {
    extraEnv.GEMINI_API_KEY = account.apiKey
  } else if (account.authMethod === 'agent-platform') {
    extraEnv.GOOGLE_GENAI_USE_VERTEXAI = 'true'
    if (account.apiKey) extraEnv.GOOGLE_API_KEY = account.apiKey
    if (account.gcpProject) extraEnv.GOOGLE_CLOUD_PROJECT = account.gcpProject
    if (account.gcpLocation) extraEnv.GOOGLE_CLOUD_LOCATION = account.gcpLocation
  } else if (account.authMethod === 'oauth-business') {
    if (account.gcpProject) extraEnv.GOOGLE_CLOUD_PROJECT = account.gcpProject
    if (account.gcpLocation) extraEnv.GOOGLE_CLOUD_LOCATION = account.gcpLocation
  }

  let cleaned = false
  return {
    account,
    extraArgs,
    geminiDir,
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
