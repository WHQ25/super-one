import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  existsSyncMock,
  readdirSyncMock,
  readFileSyncMock,
  statSyncMock,
  withAppServerRequestMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  withAppServerRequestMock: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
  statSync: statSyncMock,
}))

import { CodexPluginsService } from './codex-plugins-service'

describe('CodexPluginsService', () => {
  let service: CodexPluginsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new CodexPluginsService({
      withAppServerRequest: withAppServerRequestMock,
    } as never)
  })

  it('maps marketplace plugins from plugin/list', async () => {
    withAppServerRequestMock.mockImplementation(async (_projectPath, fn) => fn(async () => ({
      marketplaces: [
        {
          name: 'openai-curated',
          path: '/marketplaces/openai-curated/marketplace.json',
          plugins: [
            {
              id: 'github@openai-curated',
              name: 'github',
              installed: true,
              enabled: true,
              installPolicy: 'AVAILABLE',
              authPolicy: 'ON_USE',
              source: { type: 'local', path: '/plugins/github' },
              interface: {
                displayName: 'GitHub',
                shortDescription: 'Manage GitHub',
                longDescription: 'Detailed GitHub workflows',
                developerName: 'OpenAI',
                category: 'Coding',
                capabilities: ['Interactive', 'Write'],
                websiteUrl: 'https://github.com',
                privacyPolicyUrl: 'https://github.com/privacy',
                termsOfServiceUrl: 'https://github.com/tos',
                defaultPrompt: ['Review pull requests'],
                brandColor: '#000000',
                composerIcon: './assets/github-small.svg',
                logo: './assets/github.png',
                screenshots: ['./assets/github-shot.png'],
              },
            },
          ],
        },
      ],
    })))

    const result = await service.listMarketplacePlugins('/project')

    expect(result).toEqual([
      {
        name: 'github',
        marketplace: 'openai-curated',
        key: 'github@openai-curated',
        description: 'Manage GitHub',
        displayName: 'GitHub',
        longDescription: 'Detailed GitHub workflows',
        author: 'OpenAI',
        category: 'Coding',
        capabilities: ['Interactive', 'Write'],
        websiteUrl: 'https://github.com',
        privacyPolicyUrl: 'https://github.com/privacy',
        termsOfServiceUrl: 'https://github.com/tos',
        defaultPrompts: ['Review pull requests'],
        brandColor: '#000000',
        iconPath: '/plugins/github/assets/github-small.svg',
        logoPath: '/plugins/github/assets/github.png',
        screenshots: ['/plugins/github/assets/github-shot.png'],
        enabled: true,
        installPolicy: 'AVAILABLE',
        authPolicy: 'ON_USE',
        installed: true,
        installedScope: 'user',
      },
    ])
  })

  it('lists and installs remote marketplace plugins without a local source path', async () => {
    const requestMock = vi.fn(async (method: string) => {
      if (method === 'plugin/list') {
        return {
          marketplaces: [
            {
              name: 'remote-marketplace',
              path: 'https://example.com/marketplace.json',
              plugins: [
                {
                  id: 'remote-plugin@remote-marketplace',
                  name: 'remote-plugin',
                  installed: false,
                  enabled: false,
                  installPolicy: 'AVAILABLE',
                  authPolicy: 'ON_INSTALL',
                  source: { type: 'remote', url: 'https://example.com/remote-plugin.zip' },
                  interface: {
                    displayName: 'Remote Plugin',
                    shortDescription: 'Install remotely',
                    composerIcon: './icon.svg',
                  },
                },
              ],
            },
          ],
        }
      }
      return {}
    })
    withAppServerRequestMock.mockImplementation(async (_projectPath, fn) => fn(requestMock))

    const marketplace = await service.listMarketplacePlugins('/project')

    expect(marketplace).toEqual([
      {
        name: 'remote-plugin',
        marketplace: 'remote-marketplace',
        key: 'remote-plugin@remote-marketplace',
        description: 'Install remotely',
        displayName: 'Remote Plugin',
        enabled: false,
        installPolicy: 'AVAILABLE',
        authPolicy: 'ON_INSTALL',
        installed: false,
        installedScope: undefined,
      },
    ])

    await service.installPlugin('/project', 'remote-plugin@remote-marketplace')

    expect(requestMock).toHaveBeenLastCalledWith('plugin/install', {
      marketplacePath: 'https://example.com/marketplace.json',
      pluginName: 'remote-plugin',
    })
  })

  it('maps installed plugins and reads manifest metadata', async () => {
    withAppServerRequestMock.mockImplementation(async (_projectPath, fn) => fn(async () => ({
      marketplaces: [
        {
          name: 'openai-curated',
          path: '/marketplaces/openai-curated/marketplace.json',
          plugins: [
            {
              id: 'github@openai-curated',
              name: 'github',
              installed: true,
              enabled: true,
              installPolicy: 'AVAILABLE',
              authPolicy: 'ON_USE',
              source: { type: 'local', path: '/plugins/github' },
              interface: {
                displayName: 'GitHub',
                shortDescription: 'Manage GitHub',
                longDescription: 'Detailed GitHub workflows',
                developerName: 'OpenAI',
                category: 'Coding',
                capabilities: ['Interactive', 'Write'],
                websiteUrl: 'https://github.com',
                privacyPolicyUrl: 'https://github.com/privacy',
                termsOfServiceUrl: 'https://github.com/tos',
                defaultPrompt: ['Review pull requests'],
                brandColor: '#000000',
                composerIcon: './assets/github-small.svg',
                logo: './assets/github.png',
                screenshots: ['./assets/github-shot.png'],
              },
            },
            {
              id: 'linear@openai-curated',
              name: 'linear',
              installed: false,
              enabled: false,
              source: { type: 'local', path: '/plugins/linear' },
              interface: {
                shortDescription: 'Manage Linear',
              },
            },
          ],
        },
      ],
    })))
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/plugins/github/.codex-plugin/plugin.json') {
        return JSON.stringify({
          name: 'github',
          version: '0.1.0',
          description: 'Manifest description',
          author: { name: 'Manifest Author' },
        })
      }
      throw new Error('not found')
    })
    existsSyncMock.mockImplementation((path: string) =>
      path === '/plugins/github/commands'
      || path === '/plugins/github/skills'
      || path === '/plugins/github/.mcp.json'
    )

    const result = await service.listPlugins('/project')

    expect(result).toEqual([
      {
        name: 'github',
        marketplace: 'openai-curated',
        key: 'github@openai-curated',
        scope: 'user',
        description: 'Manage GitHub',
        displayName: 'GitHub',
        longDescription: 'Detailed GitHub workflows',
        author: 'OpenAI',
        category: 'Coding',
        capabilities: ['Interactive', 'Write'],
        websiteUrl: 'https://github.com',
        privacyPolicyUrl: 'https://github.com/privacy',
        termsOfServiceUrl: 'https://github.com/tos',
        defaultPrompts: ['Review pull requests'],
        brandColor: '#000000',
        iconPath: '/plugins/github/assets/github-small.svg',
        logoPath: '/plugins/github/assets/github.png',
        screenshots: ['/plugins/github/assets/github-shot.png'],
        enabled: true,
        installPolicy: 'AVAILABLE',
        authPolicy: 'ON_USE',
        version: '0.1.0',
        installPath: '/plugins/github',
        hasCommands: true,
        hasAgents: false,
        hasSkills: true,
        hasHooks: false,
        hasMcpServers: true,
        hasUpdate: false,
      },
    ])
  })

  it('reads a plugin detail and scans files from the plugin source path', async () => {
    let readCalls = 0
    withAppServerRequestMock.mockImplementation(async (_projectPath, fn) => fn(async (method: string) => {
      if (method === 'plugin/list') {
        return {
          marketplaces: [
            {
              name: 'openai-curated',
              path: '/marketplaces/openai-curated/marketplace.json',
              plugins: [
                {
                  id: 'github@openai-curated',
                  name: 'github',
                  installed: true,
                  enabled: true,
                  installPolicy: 'AVAILABLE',
                  authPolicy: 'ON_USE',
                  source: { type: 'local', path: '/plugins/github' },
                  interface: {
                    displayName: 'GitHub',
                    shortDescription: 'Manage GitHub',
                    longDescription: 'Detailed GitHub workflows',
                    developerName: 'OpenAI',
                    category: 'Coding',
                    capabilities: ['Interactive', 'Write'],
                    websiteUrl: 'https://github.com',
                    privacyPolicyUrl: 'https://github.com/privacy',
                    termsOfServiceUrl: 'https://github.com/tos',
                    defaultPrompt: ['Review pull requests'],
                    brandColor: '#000000',
                    composerIcon: './assets/github-small.svg',
                    logo: './assets/github.png',
                    screenshots: ['./assets/github-shot.png'],
                  },
                },
              ],
            },
          ],
        }
      }
      if (method === 'plugin/read') {
        readCalls += 1
        return {
          plugin: {
            description: 'Detailed description',
            mcpServers: ['github'],
            skills: [
              {
                name: 'review-pr',
                description: 'Review pull requests',
                shortDescription: 'Review PRs',
                path: '/plugins/github/skills/review-pr/SKILL.md',
                enabled: true,
                interface: {
                  displayName: 'Review PR',
                },
              },
            ],
            apps: [
              {
                id: 'github',
                name: 'GitHub',
                description: 'GitHub connector',
                installUrl: 'https://chatgpt.com/apps/github',
                needsAuth: true,
              },
            ],
          },
        }
      }
      throw new Error(`unexpected method ${method}`)
    }))
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/plugins/github/.codex-plugin/plugin.json') {
        return JSON.stringify({
          name: 'github',
          version: '0.1.0',
          description: 'Manifest description',
          author: { name: 'Manifest Author' },
        })
      }
      throw new Error('not found')
    })
    existsSyncMock.mockImplementation((path: string) => path === '/plugins/github/.mcp.json' || path === '/plugins/github/skills')
    readdirSyncMock.mockImplementation((path: string) => {
      if (path === '/plugins/github') {
        return [
          { name: 'README.md', isDirectory: () => false, isSymbolicLink: () => false },
          { name: 'skills', isDirectory: () => true, isSymbolicLink: () => false },
        ]
      }
      if (path === '/plugins/github/skills') {
        return [
          { name: 'github', isDirectory: () => true, isSymbolicLink: () => false },
        ]
      }
      if (path === '/plugins/github/skills/github') {
        return []
      }
      return []
    })
    statSyncMock.mockReturnValue({ isDirectory: () => false })

    const result = await service.readPlugin('/project', 'github@openai-curated')

    expect(readCalls).toBe(1)
    expect(result).toEqual({
      name: 'github',
      marketplace: 'openai-curated',
      key: 'github@openai-curated',
      scope: 'user',
      description: 'Detailed description',
      displayName: 'GitHub',
      longDescription: 'Detailed GitHub workflows',
      author: 'OpenAI',
      category: 'Coding',
      capabilities: ['Interactive', 'Write'],
      websiteUrl: 'https://github.com',
      privacyPolicyUrl: 'https://github.com/privacy',
      termsOfServiceUrl: 'https://github.com/tos',
      defaultPrompts: ['Review pull requests'],
      brandColor: '#000000',
      iconPath: '/plugins/github/assets/github-small.svg',
      logoPath: '/plugins/github/assets/github.png',
      screenshots: ['/plugins/github/assets/github-shot.png'],
      enabled: true,
      installPolicy: 'AVAILABLE',
      authPolicy: 'ON_USE',
      version: '0.1.0',
      installPath: '/plugins/github',
      hasCommands: false,
      hasAgents: false,
      hasSkills: true,
      hasHooks: false,
      hasMcpServers: true,
      hasUpdate: false,
      mcpServers: ['github'],
      skills: [
        {
          name: 'review-pr',
          displayName: 'Review PR',
          description: 'Review pull requests',
          shortDescription: 'Review PRs',
          path: '/plugins/github/skills/review-pr/SKILL.md',
          enabled: true,
        },
      ],
      apps: [
        {
          id: 'github',
          name: 'GitHub',
          description: 'GitHub connector',
          installUrl: 'https://chatgpt.com/apps/github',
          needsAuth: true,
        },
      ],
      files: [
        { name: 'skills', isDirectory: true, children: [{ name: 'github', isDirectory: true, children: [] }] },
        { name: 'README.md', isDirectory: false },
      ],
    })
  })

  it('installs a plugin via plugin/install', async () => {
    const requestMock = vi.fn(async () => ({
      marketplaces: [
        {
          name: 'openai-curated',
          path: '/marketplaces/openai-curated/marketplace.json',
          plugins: [
            {
              id: 'github@openai-curated',
              name: 'github',
              installed: false,
              enabled: false,
              source: { type: 'local', path: '/plugins/github' },
            },
          ],
        },
      ],
    }))
    withAppServerRequestMock
      .mockImplementationOnce(async (_projectPath, fn) => fn(requestMock))
      .mockImplementationOnce(async (_projectPath, fn) => fn(requestMock))

    await service.installPlugin('/project', 'github@openai-curated')

    expect(requestMock).toHaveBeenNthCalledWith(1, 'plugin/list', { cwds: ['/project'] })
    expect(requestMock).toHaveBeenNthCalledWith(2, 'plugin/install', {
      marketplacePath: '/marketplaces/openai-curated/marketplace.json',
      pluginName: 'github',
    })
  })

  it('uninstalls a plugin via plugin/uninstall', async () => {
    const requestMock = vi.fn(async () => ({}))
    withAppServerRequestMock.mockImplementation(async (_projectPath, fn) => fn(requestMock))

    await service.uninstallPlugin('/project', 'github@openai-curated')

    expect(requestMock).toHaveBeenCalledWith('plugin/uninstall', {
      pluginId: 'github@openai-curated',
    })
  })
})
