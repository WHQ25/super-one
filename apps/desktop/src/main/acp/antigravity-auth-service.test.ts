import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientConnection } from '@agentclientprotocol/sdk'
import { ANTIGRAVITY_AUTH_REQUIRED } from '@superone/shared/antigravity-auth'

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

vi.mock('../harness/antigravity-launch', () => ({
  resolveDesktopAntigravityLaunch: vi.fn(() => ({
    command: '/usr/local/bin/agy',
    args: ['acp'],
  })),
}))

import { AntigravityAuthService } from './antigravity-auth-service'
import {
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  prepareAntigravitySpawnContext,
  readAntigravityAuthConfig,
  validateAntigravityOAuthUrl,
  writeAntigravityAuthConfig,
} from './antigravity-profile'
import {
  authenticateAntigravityRuntime,
  prepareAntigravityProcessLaunch,
} from './antigravity-runtime-bridge'

describe('antigravity-profile & AntigravityAuthService', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'so-agy-auth-'))
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('reuses native ~/.gemini config without overriding GEMINI_HOME and strips ambient Google env vars', () => {
    const prevKey = process.env.GEMINI_API_KEY
    const prevProject = process.env.GOOGLE_CLOUD_PROJECT
    const prevGeminiHome = process.env.GEMINI_HOME
    process.env.GEMINI_API_KEY = 'ambient-leak'
    process.env.GOOGLE_CLOUD_PROJECT = 'ambient-project'
    process.env.GEMINI_HOME = '/tmp/ambient-gemini-home'
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
        customHome: homeDir,
      })
      try {
        expect(ctx.baseEnv.GEMINI_API_KEY).toBeUndefined()
        expect(ctx.baseEnv.GOOGLE_CLOUD_PROJECT).toBeUndefined()
        expect(ctx.baseEnv.GEMINI_HOME).toBeUndefined()
        expect(ctx.extraEnv.GEMINI_HOME).toBeUndefined()
        expect(ctx.extraEnv.AGY_ACP_FORCE_FILE_STORAGE).toBeUndefined()
        expect(ctx.extraEnv.GOOGLE_CLOUD_PROJECT).toBe('enterprise-proj-123')
        expect(ctx.extraEnv.GOOGLE_CLOUD_LOCATION).toBe('us-central1')
        expect(ctx.extraEnv.TMPDIR).toContain('antigravity')
      } finally {
        ctx.cleanup()
      }
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = prevKey
      if (prevProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT
      else process.env.GOOGLE_CLOUD_PROJECT = prevProject
      if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME
      else process.env.GEMINI_HOME = prevGeminiHome
    }
  })

  it('validates Google OAuth URLs and extracts stdout/stderr markers', () => {
    const validUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2F&state=xyz123'
    const parsed = validateAntigravityOAuthUrl(validUrl)
    expect(parsed.redirectUri).toBe('http://127.0.0.1:43123/')
    expect(parsed.state).toBe('xyz123')

    const v153Url =
      'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fauth%2Fcallback&state=state153'
    const parsed153 = validateAntigravityOAuthUrl(v153Url)
    expect(parsed153.redirectUri).toBe('http://localhost:43123/auth/callback')
    expect(parsed153.state).toBe('state153')

    expect(() =>
      validateAntigravityOAuthUrl('https://evil.example.com/o/oauth2/v2/auth?response_type=code'),
    ).toThrow(/unexpected/)

    const fromStdout = extractAntigravityAuthUrlFromStdoutLine(
      `Open the following link to authenticate the ACP server: ${validUrl}\r`,
    )
    expect(fromStdout).toBe(validUrl)

    const fromStderr = extractAntigravityAuthUrlsFromStderrChunk(
      `info\n__SUPERONE_ANTIGRAVITY_AUTH_URL__${validUrl}\nPlease visit the following URL to authorize: ${v153Url}\n`,
    )
    expect(fromStderr).toEqual([validUrl, v153Url])
  })

  it('completes Keyring-backed OAuth login without token files and supports logout', async () => {
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

  it('authenticates against native Keyring session and aborts immediately on interactive OAuth URL prompts', async () => {
    const okConn = {
      agent: {
        request: vi.fn(async () => ({})),
      },
    } as unknown as ClientConnection

    await authenticateAntigravityRuntime(okConn, homeDir)
    expect(readAntigravityAuthConfig(homeDir).oauthSignedIn).toBe(true)

    const launch = {
      agentId: 'antigravity',
      command: '',
      args: [] as string[],
      env: {},
    }
    const spawnOpts = await prepareAntigravityProcessLaunch(launch as never, { agentId: 'antigravity' })
    try {
      const pendingConn = {
        agent: {
          request: vi.fn(
            () =>
              new Promise<void>(() => {
                spawnOpts.onStderrData?.(
                  'Please visit the following URL to authorize: https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A43123%2Fauth%2Fcallback&state=s1\n',
                )
              }),
          ),
        },
      } as unknown as ClientConnection

      await expect(authenticateAntigravityRuntime(pendingConn, homeDir)).rejects.toThrow(
        ANTIGRAVITY_AUTH_REQUIRED,
      )
      expect(readAntigravityAuthConfig(homeDir).oauthSignedIn).toBe(false)
    } finally {
      spawnOpts.onExit?.()
    }
  })
})
