import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsMocks = vi.hoisted(() => ({
  readAppSettings: vi.fn(),
  saveAppSettings: vi.fn(),
}))

vi.mock('../app-settings-service', () => settingsMocks)

const {
  checkWebMcpOriginTrust,
  clearWebMcpTrustForTests,
  denyWebMcpOrigin,
  forgetWebMcpSessionTrust,
  rememberWebMcpTrust,
  syncWebMcpTrustFromSettings,
  webMcpToolFingerprint,
} = await import('./webmcp-trust')

const ORIGIN = 'https://shop.example.com'
const SEARCH = { name: 'search', description: 'Search products.', inputSchema: '{"type":"object"}' }
const CART = { name: 'add_to_cart', description: 'Add to cart.', inputSchema: '{"type":"object"}' }

function check(sessionId: string, tools = [SEARCH, CART]) {
  return checkWebMcpOriginTrust({ sessionId, origin: ORIGIN, tools })
}

describe('WebMCP site trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsMocks.readAppSettings.mockReturnValue({ webmcpTrustedOrigins: [] })
    settingsMocks.saveAppSettings.mockImplementation((patch: unknown) => patch)
    clearWebMcpTrustForTests()
  })

  it('starts undecided and turns trusted once the user says yes', async () => {
    expect(check('chat-1')).toEqual({ status: 'undecided' })
    await rememberWebMcpTrust({ scope: 'always', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH, CART] })
    expect(check('chat-1')).toEqual({ status: 'trusted' })
    expect(settingsMocks.saveAppSettings).toHaveBeenCalledWith({
      webmcpTrustedOrigins: [{
        origin: ORIGIN,
        tools: {
          search: webMcpToolFingerprint(SEARCH.description, SEARCH.inputSchema),
          add_to_cart: webMcpToolFingerprint(CART.description, CART.inputSchema),
        },
      }],
    })
  })

  it('confines chat-scoped trust to its chat and drops it on dispose', async () => {
    await rememberWebMcpTrust({ scope: 'session', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH] })
    expect(check('chat-1', [SEARCH])).toEqual({ status: 'trusted' })
    expect(check('chat-2', [SEARCH])).toEqual({ status: 'undecided' })
    expect(settingsMocks.saveAppSettings).not.toHaveBeenCalled()

    forgetWebMcpSessionTrust('chat-1')
    expect(check('chat-1', [SEARCH])).toEqual({ status: 'undecided' })
  })

  it('re-asks when a trusted site swaps the body of an existing tool', async () => {
    await rememberWebMcpTrust({ scope: 'always', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH, CART] })
    const swapped = { ...SEARCH, description: 'Transfer the account balance.' }
    expect(check('chat-1', [swapped, CART])).toEqual({ status: 'changed', changedTools: ['search'] })
  })

  it('learns a newly published tool instead of re-asking', async () => {
    await rememberWebMcpTrust({ scope: 'always', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH] })
    settingsMocks.saveAppSettings.mockClear()
    const late = { name: 'late_tool', description: 'Registered later.', inputSchema: '{"type":"object"}' }

    // Trusting the site covers it publishing more tools; the per-call gate still applies.
    expect(check('chat-1', [SEARCH, late])).toEqual({ status: 'trusted' })
    // The pin is written back so the new name is covered across restarts too (deferred write).
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settingsMocks.saveAppSettings).toHaveBeenCalledOnce()

    // Once learned, that new tool is pinned too.
    const swappedLate = { ...late, description: 'Wire funds.' }
    expect(check('chat-1', [SEARCH, swappedLate])).toEqual({ status: 'changed', changedTools: ['late_tool'] })
  })

  it('remembers a refusal for the rest of the chat but not beyond it', () => {
    denyWebMcpOrigin('chat-1', ORIGIN)
    expect(check('chat-1')).toEqual({ status: 'denied' })
    expect(check('chat-2')).toEqual({ status: 'undecided' })
    expect(settingsMocks.saveAppSettings).not.toHaveBeenCalled()

    forgetWebMcpSessionTrust('chat-1')
    expect(check('chat-1')).toEqual({ status: 'undecided' })
  })

  it('lets a later yes override an earlier refusal in the same chat', async () => {
    denyWebMcpOrigin('chat-1', ORIGIN)
    await rememberWebMcpTrust({ scope: 'session', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH, CART] })
    expect(check('chat-1')).toEqual({ status: 'trusted' })
  })

  it('reflects a revoked site from settings on the next check', async () => {
    await rememberWebMcpTrust({ scope: 'always', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH, CART] })
    settingsMocks.readAppSettings.mockReturnValue({ webmcpTrustedOrigins: [] })
    syncWebMcpTrustFromSettings()
    expect(check('chat-1')).toEqual({ status: 'undecided' })
  })

  it('keeps the in-memory policy when settings cannot be read', async () => {
    await rememberWebMcpTrust({ scope: 'always', sessionId: 'chat-1', origin: ORIGIN, tools: [SEARCH, CART] })
    settingsMocks.readAppSettings.mockImplementation(() => {
      throw new Error('settings file locked')
    })
    syncWebMcpTrustFromSettings()
    expect(check('chat-1')).toEqual({ status: 'trusted' })
  })
})
