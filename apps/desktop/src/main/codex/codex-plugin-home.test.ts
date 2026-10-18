import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexPluginDirectoryError } from '@superone/shared/codex-plugin-shelf'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  login: vi.fn(),
  list: vi.fn(),
  home: vi.fn(),
}))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('@superone/runtime/usage', () => ({ readCodexLogin: mocks.login }))
vi.mock('./codex-account-store', () => ({ codexAccountStore: () => ({
  list: mocks.list, home: mocks.home, cliHome: '/cli',
}) }))

import { fetchCodexPluginCategory, fetchCodexPluginDetail, fetchCodexPluginHome } from './codex-plugin-home'

const account = { id: 'managed', isDefault: true, signedIn: true }
const homeBody = {
  sections: [{
    id: 'featured',
    title: 'Popular',
    url_slug: 'featured',
    plugins: [{
      id: 'plugin_gmail',
      display_name: 'Gmail',
      short_description: 'Read and manage Gmail',
      icon_url: 'https://cdn.example/gmail.png',
      status: 'ENABLED',
      installation_policy: 'AVAILABLE',
    }],
  }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockReturnValue([account])
  mocks.home.mockReturnValue('/managed')
  mocks.login.mockReturnValue({ accessToken: 'secret-test-token', accountId: 'test-account' })
  mocks.fetch.mockResolvedValue(Response.json(homeBody))
})

describe('Codex plugin home', () => {
  it('reads the curated shelves with the Codex login and does not log the token', async () => {
    await expect(fetchCodexPluginHome()).resolves.toMatchObject({
      0: { title: 'Popular', plugins: [{ name: 'Gmail' }] },
    })
    expect(mocks.login).toHaveBeenCalledWith('/managed')
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/ps/plugins/home')
    expect(init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer secret-test-token',
        'ChatGPT-Account-Id': 'test-account',
        'OAI-Product-Sku': 'codex',
      },
    })
  })

  it('requires a Codex login without refreshing it', async () => {
    mocks.login.mockReturnValue(null)
    await expect(fetchCodexPluginHome()).rejects.toThrow(CodexPluginDirectoryError.signedOut)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('maps an expired login and hides transport details', async () => {
    mocks.fetch.mockResolvedValue(new Response('secret-test-token', { status: 401 }))
    await expect(fetchCodexPluginHome()).rejects.toThrow(CodexPluginDirectoryError.expired)

    mocks.fetch.mockRejectedValue(new Error('socket hang up secret-test-token'))
    await expect(fetchCodexPluginHome()).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginHome()).rejects.not.toThrow(/secret-test-token/)
  })

  it('rejects a document that is not a shelf list', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ plugins: [] }))
    await expect(fetchCodexPluginHome()).rejects.toThrow(CodexPluginDirectoryError.unavailable)
  })
})

describe('Codex plugin category', () => {
  it('requests one category page and follows the cursor', async () => {
    const body = {
      plugins: [{
        id: 'plugin_canva',
        display_name: 'Canva',
        short_description: 'Create and edit designs',
        status: 'ENABLED',
        installation_policy: 'AVAILABLE',
      }],
      pagination: { limit: 700, next_page_token: 'cursor-1' },
      category: { title: 'Popular' },
    }
    mocks.fetch.mockImplementation(async () => Response.json(body))

    await expect(fetchCodexPluginCategory('developer-tools', null)).resolves.toMatchObject({
      title: 'Popular',
      nextPageToken: 'cursor-1',
      plugins: [{ name: 'Canva' }],
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://chatgpt.com/backend-api/ps/plugin-categories/developer-tools/plugins?scope=GLOBAL&limit=50',
    )

    await fetchCodexPluginCategory('featured', 'cursor-1')
    const nextUrl = String(mocks.fetch.mock.calls[1][0])
    expect(nextUrl).toContain('/ps/plugin-categories/featured/plugins?')
    expect(nextUrl).toContain('pageToken=cursor-1')
  })

  it('refuses an unsafe slug or cursor before calling the service', async () => {
    await expect(fetchCodexPluginCategory('developer tools', null)).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginCategory('../featured', null)).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginCategory('featured', 'bad\ncursor')).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('hides the cursor and the login when the request fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('socket hang up secret-test-token pageToken=cursor-secret'))
    await expect(fetchCodexPluginCategory('featured', 'cursor-secret')).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginCategory('featured', 'cursor-secret')).rejects.not.toThrow(/secret|cursor/)
  })
})

describe('Codex plugin detail', () => {
  it('requests one hosted plugin document', async () => {
    mocks.fetch.mockImplementation(async () => Response.json({
      id: 'plugin_connector_1p_github',
      status: 'ENABLED',
      installation_policy: 'AVAILABLE',
      release: {
        display_name: 'GitHub',
        version: '2.4.1',
        interface: { short_description: 'Triage pull requests', developer_name: 'GitHub' },
      },
    }))
    await expect(fetchCodexPluginDetail('plugin_connector_1p_github')).resolves.toMatchObject({
      name: 'GitHub',
      developerName: 'GitHub',
      version: '2.4.1',
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://chatgpt.com/backend-api/ps/plugins/plugin_connector_1p_github',
    )
  })

  it('refuses an unsafe id before calling the service', async () => {
    await expect(fetchCodexPluginDetail('plugin id')).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginDetail('../plugin_connector_1p_github')).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginDetail('notes@mine')).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects a document for a different plugin and hides transport details', async () => {
    mocks.fetch.mockImplementation(async () => Response.json({
      id: 'plugin_other',
      release: { display_name: 'Other' },
    }))
    await expect(fetchCodexPluginDetail('plugin_connector_1p_github')).rejects.toThrow(CodexPluginDirectoryError.unavailable)

    mocks.fetch.mockRejectedValue(new Error('socket hang up secret-test-token plugin_connector_1p_secret'))
    await expect(fetchCodexPluginDetail('plugin_connector_1p_secret')).rejects.toThrow(CodexPluginDirectoryError.unavailable)
    await expect(fetchCodexPluginDetail('plugin_connector_1p_secret')).rejects.not.toThrow(/secret/)
  })
})
