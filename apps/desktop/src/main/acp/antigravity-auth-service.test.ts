import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  net: {
    fetch: globalThis.fetch,
  },
}))

import { AntigravityAuthService } from './antigravity-auth-service'
import {
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  prepareAntigravitySpawnContext,
  resolveAntigravityTokenPath,
  validateAntigravityOAuthUrl,
  writeAntigravityAuthConfig,
} from './antigravity-profile'

describe('antigravity-profile & AntigravityAuthService', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'so-agy-auth-'))
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('prepares isolated GEMINI_HOME, settings.json, and strips ambient Google env vars', () => {
    const prevKey = process.env.GEMINI_API_KEY
    const prevProject = process.env.GOOGLE_CLOUD_PROJECT
    process.env.GEMINI_API_KEY = 'ambient-leak'
    process.env.GOOGLE_CLOUD_PROJECT = 'ambient-project'
    try {
      writeAntigravityAuthConfig(
        {
          authMethod: 'oauth-business',
          gcpProject: 'enterprise-proj-123',
          gcpLocation: 'us-central1',
        },
        homeDir,
      )
      const ctx = prepareAntigravitySpawnContext({
        harnessPath: '/opt/agy/localharness_external',
        customHome: homeDir,
      })
      try {
        expect(ctx.baseEnv.GEMINI_API_KEY).toBeUndefined()
        expect(ctx.baseEnv.GOOGLE_CLOUD_PROJECT).toBeUndefined()
        expect(ctx.extraEnv.ANTIGRAVITY_HARNESS_PATH).toBe('/opt/agy/localharness_external')
        expect(ctx.extraEnv.AGY_ACP_FORCE_FILE_STORAGE).toBe('1')
        expect(ctx.extraEnv.GOOGLE_CLOUD_PROJECT).toBe('enterprise-proj-123')
        expect(ctx.extraEnv.GOOGLE_CLOUD_LOCATION).toBe('us-central1')
        expect(ctx.extraEnv.GEMINI_HOME).toContain('antigravity')
      } finally {
        ctx.cleanup()
      }
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = prevKey
      if (prevProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT
      else process.env.GOOGLE_CLOUD_PROJECT = prevProject
    }
  })

  it('validates Google OAuth URLs and extracts stdout/stderr markers', () => {
    const validUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2F&state=xyz123'
    const parsed = validateAntigravityOAuthUrl(validUrl)
    expect(parsed.redirectUri).toBe('http://127.0.0.1:43123/')
    expect(parsed.state).toBe('xyz123')

    expect(() =>
      validateAntigravityOAuthUrl('https://evil.example.com/o/oauth2/v2/auth?response_type=code'),
    ).toThrow(/unexpected/)

    const fromStdout = extractAntigravityAuthUrlFromStdoutLine(
      `Open the following link to authenticate the ACP server: ${validUrl}\r`,
    )
    expect(fromStdout).toBe(validUrl)

    const fromStderr = extractAntigravityAuthUrlsFromStderrChunk(
      `info\n__SUPERONE_ANTIGRAVITY_AUTH_URL__${validUrl}\n`,
    )
    expect(fromStderr).toEqual([validUrl])
  })

  it('completes OAuth login with callback forwarding and supports logout', async () => {
    const validUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2F&state=state_abc'
    let finishAuthenticate: (() => void) | null = null
    const forwarded: Array<{ callbackUrl: string; redirectUri: string; state: string }> = []

    const service = new AntigravityAuthService({
      customHome: homeDir,
      hasRuntime: () => true,
      openExternal: async () => undefined,
      onAuthChanged: () => undefined,
      forwardCallback: async (callbackUrl, pending) => {
        forwarded.push({ callbackUrl, ...pending })
        const tokenPath = resolveAntigravityTokenPath(homeDir)
        mkdirSync(dirname(tokenPath), { recursive: true })
        writeFileSync(tokenPath, JSON.stringify({ refresh_token: 'rt_123' }))
        finishAuthenticate?.()
      },
      openConnection: async ({ onAuthUrl }) => ({
        initialize: async () => ({ authMethods: [{ id: 'oauth-personal' }] }),
        authenticate: () =>
          new Promise<void>((resolve) => {
            finishAuthenticate = resolve
            onAuthUrl(validUrl)
          }),
        close: async () => undefined,
      }),
    })

    const initial = await service.handle({ action: 'status' })
    expect(initial.status).toBe('signed_out')

    const started = await service.handle({ action: 'start', authMethod: 'oauth-personal' })
    expect(started.status === 'starting' || started.status === 'waiting').toBe(true)

    await new Promise((r) => setTimeout(r, 10))
    const waiting = await service.handle({ action: 'status' })
    expect(waiting.status).toBe('waiting')
    expect(waiting.authUrl).toBe(validUrl)

    await service.handle({
      action: 'submitCallback',
      loginId: waiting.loginId!,
      callbackUrl: 'http://127.0.0.1:43123/?code=auth_code_1&state=state_abc',
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(forwarded).toHaveLength(1)
    const afterLogin = await service.handle({ action: 'status' })
    expect(afterLogin.status).toBe('signed_in')

    const afterLogout = await service.handle({ action: 'logout' })
    expect(afterLogout.status).toBe('signed_out')
  })
})
