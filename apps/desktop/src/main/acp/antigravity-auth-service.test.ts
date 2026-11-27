import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANTIGRAVITY_AUTH_REQUIRED,
  ANTIGRAVITY_CLI_ACCOUNT_ID,
  antigravityAccountId,
  antigravityAccountProviderId,
  assertAntigravityAccountSwitchAllowed,
} from '@superone/shared/antigravity-auth'
import { AntigravityAuthService, type AntigravityCodeLoginHandle } from './antigravity-auth-service'
import {
  antigravityAccountStore,
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  prepareAntigravitySpawnContext,
  validateAntigravityLoginCodeResponse,
} from './antigravity-profile'
import { authenticateAntigravityRuntime } from './antigravity-runtime-bridge'

const tempHomes: string[] = []

function makeTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-multi-'))
  tempHomes.push(dir)
  return dir
}

afterEach(() => {
  while (tempHomes.length > 0) {
    rmSync(tempHomes.pop()!, { recursive: true, force: true })
  }
})

describe('Antigravity multi-account store, isolation & auth service', () => {
  it('validates account provider IDs and blocks switching mid-conversation', () => {
    const cliProvider = antigravityAccountProviderId(ANTIGRAVITY_CLI_ACCOUNT_ID)
    expect(antigravityAccountId(cliProvider)).toBe('cli')
    expect(() => antigravityAccountId('antigravity-account:not-a-uuid')).toThrow()
    expect(() => assertAntigravityAccountSwitchAllowed(cliProvider, 'antigravity-account:11111111-1111-4111-8111-111111111111', false)).not.toThrow()
    expect(() => assertAntigravityAccountSwitchAllowed(cliProvider, 'antigravity-account:11111111-1111-4111-8111-111111111111', true)).toThrow(
      /new conversation/i,
    )
  })

  it('creates isolated profiles with --gemini-dir and SSH_CONNECTION for managed oauth-personal accounts', () => {
    const homeDir = makeTempHome()
    const store = antigravityAccountStore(homeDir)

    const googleWork = store.create({
      label: 'Work Google',
      authMethod: 'oauth-personal',
    })
    const vertexProd = store.create({
      label: 'Vertex Prod',
      authMethod: 'agent-platform',
      apiKey: 'vertex-secret',
      gcpProject: 'my-gcp-project',
      gcpLocation: 'us-central1',
    })

    const googleCtx = prepareAntigravitySpawnContext({ accountId: googleWork.id, customHome: homeDir })
    try {
      expect(googleCtx.geminiDir).toBe(googleWork.profileDir)
      expect(googleCtx.extraArgs).toEqual([
        '--gemini-dir',
        googleWork.profileDir!,
        '--app-data-dir',
        'antigravity-acp',
      ])
      expect(googleCtx.extraEnv.GEMINI_HOME).toBe(googleWork.profileDir)
      expect(googleCtx.extraEnv.AGY_ACP_FORCE_FILE_STORAGE).toBe('1')
      expect(googleCtx.extraEnv.SSH_CONNECTION).toBeTruthy()
      expect(existsSync(join(googleWork.profileDir!, 'antigravity-acp', 'settings.json'))).toBe(true)
    } finally {
      googleCtx.cleanup()
    }

    const vertexCtx = prepareAntigravitySpawnContext({ accountId: vertexProd.id, customHome: homeDir })
    try {
      expect(vertexCtx.extraEnv.GOOGLE_GENAI_USE_VERTEXAI).toBe('true')
      expect(vertexCtx.extraEnv.GOOGLE_API_KEY).toBe('vertex-secret')
      expect(vertexCtx.extraEnv.GOOGLE_CLOUD_PROJECT).toBe('my-gcp-project')
      expect(vertexCtx.extraEnv.GOOGLE_CLOUD_LOCATION).toBe('us-central1')
      expect(vertexCtx.extraEnv.SSH_CONNECTION).toBeUndefined()
    } finally {
      vertexCtx.cleanup()
    }

    store.setDefault(vertexProd.id)
    expect(store.defaultAccountId()).toBe(vertexProd.id)
    expect(store.defaultProviderId()).toBe(antigravityAccountProviderId(vertexProd.id))

    store.remove(vertexProd.id)
    expect(store.defaultAccountId()).toBe(ANTIGRAVITY_CLI_ACCOUNT_ID)
    expect(existsSync(vertexProd.profileDir!)).toBe(false)
  })

  it('completes isolated oauth-personal login via --login code flow and supports logout', async () => {
    const homeDir = makeTempHome()
    const codeUrl =
      'https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=st123'
    expect(extractAntigravityAuthUrlFromStdoutLine(`  ${codeUrl}  `)).toBe(codeUrl)
    expect(
      extractAntigravityAuthUrlsFromStderrChunk(
        `__SUPERONE_ANTIGRAVITY_AUTH_URL__http://127.0.0.1:43123/\nPlease visit the following URL to authorize: ${codeUrl}\n`,
      ),
    ).toContain(codeUrl)
    expect(
      validateAntigravityLoginCodeResponse(
        { redirectUri: 'https://antigravity.google/oauth-callback', state: 'st123' },
        '4/0Ab-code_1.x~',
      ),
    ).toBe('4/0Ab-code_1.x~')

    let resolveLogin!: () => void
    const submitted: string[] = []
    const openExternal = vi.fn(async () => {})
    const logoutSpy = vi.fn(async () => ({}))

    const service = new AntigravityAuthService({
      customHome: homeDir,
      hasRuntime: () => true,
      openExternal,
      openConnection: async () => ({
        initialize: async () => ({ agentCapabilities: { auth: { logout: {} } } }),
        authenticate: async () => ({}),
        logout: logoutSpy,
        close: async () => {},
      }),
      startCodeLogin: async ({ onAuthUrl }) => {
        onAuthUrl(codeUrl)
        const handle: AntigravityCodeLoginHandle = {
          submit: (response) => {
            submitted.push(response)
            resolveLogin()
          },
          completed: new Promise<void>((resolve) => {
            resolveLogin = resolve
          }),
          close: async () => {},
        }
        return handle
      },
    })

    const createdSnap = await service.handle({
      action: 'create',
      label: 'Personal 2',
      authMethod: 'oauth-personal',
    })
    const created = createdSnap.accounts.find((a) => a.label === 'Personal 2')!
    expect(created.signedIn).toBe(false)

    const started = await service.handle({ action: 'startLogin', accountId: created.id })
    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith(codeUrl)
    })
    const waiting = await service.handle({ action: 'list' })
    expect(waiting.activeLogin?.mode).toBe('code')
    expect(waiting.activeLogin?.status).toBe('waiting')

    await service.handle({
      action: 'submitLoginResponse',
      loginId: started.activeLogin!.loginId,
      response: '4/0Ab-code_1.x~',
    })
    expect(submitted).toEqual(['4/0Ab-code_1.x~'])

    await vi.waitFor(async () => {
      const done = await service.handle({ action: 'list' })
      expect(done.activeLogin).toBeNull()
      expect(done.accounts.find((a) => a.id === created.id)?.signedIn).toBe(true)
    })

    const afterLogout = await service.handle({ action: 'logout', accountId: created.id })
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(afterLogout.accounts.find((a) => a.id === created.id)?.signedIn).toBe(false)
  })

  it('authenticates configured account in runtime and fails fast when missing required api key', async () => {
    const homeDir = makeTempHome()
    const store = antigravityAccountStore(homeDir)
    const apiAccount = store.create({
      label: 'Keyless',
      authMethod: 'gemini-api-key',
    })

    const fakeConn = {
      agent: {
        request: vi.fn(async () => ({})),
      },
    } as never

    await expect(
      authenticateAntigravityRuntime(fakeConn, apiAccount.id, homeDir),
    ).rejects.toThrow(ANTIGRAVITY_AUTH_REQUIRED)

    store.configure({
      accountId: apiAccount.id,
      authMethod: 'gemini-api-key',
      apiKey: 'AIza-test-key',
    })
    await authenticateAntigravityRuntime(fakeConn, apiAccount.id, homeDir)
    expect((fakeConn as { agent: { request: ReturnType<typeof vi.fn> } }).agent.request).toHaveBeenCalledWith(
      'authenticate',
      { methodId: 'gemini-api-key' },
    )
  })
})
