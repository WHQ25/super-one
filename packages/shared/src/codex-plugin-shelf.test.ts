import { describe, expect, it } from 'vitest'
import {
  CODEX_CURATED_REMOTE_MARKETPLACE,
  CODEX_PLUGIN_HOME_LIMIT,
  CODEX_PLUGIN_SHELF_LIMIT,
  applyCodexInstalledCards,
  applyCodexInstalledPlugins,
  codexInstalledIdentities,
  codexPluginInstallParams,
  codexPluginPageToken,
  codexPluginShelf,
  codexShelfCardsFromList,
  codexShelfCardsFromSearch,
  parseCodexPluginCategory,
  parseCodexPluginDetail,
  parseCodexPluginHome,
} from './codex-plugin-shelf'

function homePlugin(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `plugin_${index}`,
    display_name: `Plugin ${index}`,
    short_description: `Description ${index}`,
    icon_url: `https://cdn.example/icon-${index}.png`,
    icon_url_dark: `https://cdn.example/icon-${index}-dark.png`,
    status: 'ENABLED',
    installation_policy: 'AVAILABLE',
    ...overrides,
  }
}

describe('Codex plugin shelves', () => {
  it('keeps home section order and caps each section at the service page', () => {
    const plugins = Array.from({ length: 12 }, (_, index) => homePlugin(index + 1))
    const sections = parseCodexPluginHome({
      sections: [
        { id: 'featured', title: 'Popular', url_slug: 'featured', plugins },
        { id: 'new-and-noteworthy', title: 'New & Noteworthy', url_slug: 'new-and-noteworthy', plugins: [homePlugin(20)] },
        { id: 'empty', title: 'Empty', url_slug: 'empty', plugins: [] },
      ],
    })
    expect(sections?.map((section) => section.title)).toEqual(['Popular', 'New & Noteworthy'])
    expect(parseCodexPluginHome({
      sections: [{ id: 'developer tools', title: 'Developer Tools', url_slug: 'developer-tools', plugins: [homePlugin(1)] }],
    })?.[0]).toMatchObject({ id: 'developer tools', urlSlug: 'developer-tools' })
    expect(sections?.[0]?.plugins).toHaveLength(CODEX_PLUGIN_HOME_LIMIT)
    expect(sections?.[0]?.plugins[0]).toMatchObject({
      id: 'plugin_1',
      name: 'Plugin 1',
      description: 'Description 1',
      iconUrl: 'https://cdn.example/icon-1.png',
      iconUrlDark: 'https://cdn.example/icon-1-dark.png',
      install: { pluginName: 'plugin_1', remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE },
    })
    expect(sections?.[0]?.plugins.some((card) => card.id === 'plugin_10')).toBe(false)
    expect(codexPluginShelf(sections?.[0]?.plugins ?? [])).toHaveLength(CODEX_PLUGIN_SHELF_LIMIT)
    expect(codexPluginShelf(sections?.[0]?.plugins ?? []).at(-1)?.id).toBe('plugin_6')
  })

  it('marks unavailable and unsafe icons as not installable', () => {
    const sections = parseCodexPluginHome({
      sections: [{
        id: 'featured',
        title: 'Popular',
        url_slug: 'featured',
        plugins: [
          homePlugin(1, { display_name: 'Gmail', status: 'DISABLED_BY_ADMIN', installation_policy: 'NOT_AVAILABLE', icon_url: 'http://cdn.example/insecure.png' }),
          homePlugin(2, { display_name: 'Broken', icon_url: 'javascript:alert(1)', icon_url_dark: 'https://user:pw@cdn.example/a.png' }),
          { id: 'plugin_3' },
        ],
      }],
    })
    expect(sections?.[0]?.plugins).toEqual([
      expect.objectContaining({ name: 'Gmail', install: null, iconUrl: null, installed: false }),
      expect.objectContaining({
        name: 'Broken',
        install: expect.objectContaining({ pluginName: 'plugin_2' }),
        iconUrl: null,
        iconUrlDark: null,
      }),
    ])
  })

  it('rejects a payload that is not a home document', () => {
    expect(parseCodexPluginHome({ plugins: [] })).toBeNull()
    expect(parseCodexPluginHome(null)).toBeNull()
  })

  it('reads a category page past the home shelf and keeps its cursor', () => {
    const plugins = Array.from({ length: 12 }, (_, index) => homePlugin(index + 1))
    plugins.push(homePlugin(1))
    const page = parseCodexPluginCategory({
      plugins,
      pagination: { limit: 700, next_page_token: 'cursor-1' },
      category: { title: 'Popular', description: 'Plugins people use most' },
    })
    expect(page?.plugins.map((card) => card.id)).toEqual(Array.from({ length: 12 }, (_, index) => `plugin_${index + 1}`))
    expect(page).toMatchObject({
      nextPageToken: 'cursor-1',
      title: 'Popular',
      description: 'Plugins people use most',
    })
    expect(parseCodexPluginCategory({ plugins: [] })).toEqual({
      plugins: [],
      nextPageToken: null,
      title: null,
      description: null,
    })
    expect(parseCodexPluginCategory({ sections: [] })).toBeNull()
    expect(codexPluginPageToken('bad\ntoken')).toBeNull()
    expect(codexPluginPageToken('a'.repeat(4097))).toBeNull()
  })

  it('stamps installed category cards without mutating the page', () => {
    const page = parseCodexPluginCategory({ plugins: [homePlugin(1, { display_name: 'GitHub' })] })!
    const marked = applyCodexInstalledCards(page.plugins, [{
      key: 'github@openai-curated-remote',
      remotePluginId: 'plugin_1',
      name: 'github',
    }])
    expect(marked[0]).toMatchObject({ installed: true, installedKey: 'github@openai-curated-remote', install: null })
    expect(page.plugins[0]?.install).not.toBeNull()
  })

  it('stamps installed curated cards by remote id and clears install', () => {
    const sections = parseCodexPluginHome({
      sections: [{ id: 'featured', title: 'Popular', url_slug: 'featured', plugins: [homePlugin(1, { display_name: 'GitHub' })] }],
    })!
    const marked = applyCodexInstalledPlugins(sections, [{
      key: 'github@openai-curated-remote',
      remotePluginId: 'plugin_1',
      name: 'github',
    }])
    expect(marked[0]?.plugins[0]).toMatchObject({
      installed: true,
      installedKey: 'github@openai-curated-remote',
      install: null,
    })
    expect(sections[0]?.plugins[0]?.install).not.toBeNull()
  })

  it('reads installed identities and search cards without a full catalog', () => {
    expect(codexInstalledIdentities({
      marketplaces: [{
        name: 'openai-curated-remote',
        path: null,
        plugins: [
          { id: 'github@openai-curated-remote', remotePluginId: 'plugin_1', name: 'github', installed: true },
          { id: 'gmail@openai-curated-remote', remotePluginId: 'plugin_2', name: 'gmail', installed: false },
        ],
      }],
    })).toEqual([{ key: 'github@openai-curated-remote', remotePluginId: 'plugin_1', name: 'github' }])

    expect(codexShelfCardsFromSearch({
      data: [{
        marketplaceName: 'openai-curated-remote',
        marketplacePath: null,
        plugin: {
          id: 'health@openai-curated-remote',
          remotePluginId: 'plugin_health',
          name: 'health',
          installed: false,
          installPolicy: 'AVAILABLE',
          interface: { displayName: 'Health', shortDescription: 'Explore health data', logoUrl: 'https://cdn.example/health.png' },
        },
      }],
    })).toEqual([expect.objectContaining({
      id: 'plugin_health',
      name: 'Health',
      install: { pluginName: 'plugin_health', remoteMarketplaceName: 'openai-curated-remote' },
    })])
  })

  it('maps personal plugins from an explicit marketplace list', () => {
    expect(codexShelfCardsFromList({
      marketplaces: [{
        name: 'mine',
        path: '/marketplaces/mine',
        plugins: [{
          id: 'notes@mine',
          name: 'notes',
          installed: false,
          interface: { displayName: 'Notes', shortDescription: 'Local notes' },
        }],
      }],
    })).toEqual([expect.objectContaining({
      name: 'Notes',
      install: { pluginName: 'notes', marketplacePath: '/marketplaces/mine' },
    })])
  })

  it('builds a remote install request and rejects unsafe targets', () => {
    expect(codexPluginInstallParams({
      pluginName: 'plugin_1',
      remoteMarketplaceName: 'openai-curated-remote',
    })).toEqual({ remoteMarketplaceName: 'openai-curated-remote', pluginName: 'plugin_1' })
    expect(() => codexPluginInstallParams({ pluginName: '../github', remoteMarketplaceName: 'openai-curated-remote' })).toThrow(/plugin id/)
    expect(() => codexPluginInstallParams({
      pluginName: 'plugin_1',
      remoteMarketplaceName: 'openai-curated-remote',
      marketplacePath: '/marketplaces/mine',
    })).toThrow(/target/)
    expect(() => codexPluginInstallParams({ pluginName: 'notes', marketplacePath: '/tmp/../mine' })).toThrow(/target/)
  })

  it('reads a hosted plugin document and drops unsafe or local-only fields', () => {
    const skills = Array.from({ length: 41 }, (_, index) => ({ name: `skill-${index}` }))
    const detail = parseCodexPluginDetail({
      id: 'plugin_connector_1p_github',
      name: 'github',
      creator_name: 'Fallback Dev',
      status: 'ENABLED',
      installation_policy: 'AVAILABLE',
      release: {
        version: '2.4.1',
        display_name: 'GitHub',
        description: 'Work with GitHub',
        bundle_download_url: 'https://cdn.example/secret-bundle.zip',
        interface: {
          short_description: 'Triage pull requests',
          long_description: 'GitHub helps you triage pull requests.\nReview checks and publish.',
          developer_name: 'GitHub',
          category: 'Developer Tools',
          capabilities: ['Pull requests', 'Issues', 'Pull requests'],
          website_url: 'https://github.com/apps',
          privacy_policy_url: 'https://github.com/privacy',
          terms_of_service_url: 'http://github.com/terms',
          logo_url: 'https://cdn.example/gh.png',
          logo_url_dark: 'https://user:pw@cdn.example/gh-dark.png',
          screenshot_urls: ['https://cdn.example/shot.png', 'http://cdn.example/insecure.png', 'javascript:alert(1)'],
          default_prompts: ['Review my latest PR'],
        },
        skills,
        mcp_servers: [{ key: 'github' }, 'calendar'],
      },
    })
    expect(detail).toMatchObject({
      id: 'plugin_connector_1p_github',
      name: 'GitHub',
      description: 'Triage pull requests',
      longDescription: 'GitHub helps you triage pull requests.\nReview checks and publish.',
      developerName: 'GitHub',
      category: 'Developer Tools',
      version: '2.4.1',
      websiteUrl: 'https://github.com/apps',
      privacyPolicyUrl: 'https://github.com/privacy',
      termsOfServiceUrl: null,
      iconUrl: 'https://cdn.example/gh.png',
      iconUrlDark: null,
      capabilities: ['Pull requests', 'Issues'],
      screenshotUrls: ['https://cdn.example/shot.png'],
      apps: [],
      mcpServers: ['github', 'calendar'],
      prompts: ['Review my latest PR'],
      install: { pluginName: 'plugin_connector_1p_github', remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE },
    })
    expect(detail?.skills).toHaveLength(40)
    expect(JSON.stringify(detail)).not.toContain('secret-bundle')
    expect(parseCodexPluginDetail({
      plugin: {
        id: 'plugin_asdk_app_notes',
        creator_name: 'Ada',
        status: 'ENABLED',
        installation_policy: 'AVAILABLE',
        release: {
          display_name: 'Notes',
          interface: { short_description: 'Take notes', long_description: 'Take notes' },
        },
      },
    })).toMatchObject({ name: 'Notes', developerName: 'Ada', longDescription: null })
    expect(parseCodexPluginDetail({ id: '../plugin', release: { display_name: 'Bad' } })).toBeNull()
    expect(parseCodexPluginDetail({ id: 'plugin id', release: { display_name: 'Bad' } })).toBeNull()
    expect(parseCodexPluginDetail({ id: 'notes@mine', release: { display_name: 'Notes' } })).toBeNull()
    expect(parseCodexPluginDetail({ sections: [] })).toBeNull()
    expect(parseCodexPluginDetail({
      id: 'plugin_asdk_app_notion',
      release: {
        display_name: 'Notion',
        app_templates: [{
          template_id: 'notion',
          name: 'Notion',
          description: 'Create documentation — Generate PRDs',
          logo_url: 'https://cdn.example/notion.png',
          logo_url_dark: 'http://cdn.example/notion-dark.png',
        }, {
          template_id: 'notion',
          name: 'Duplicate',
        }],
        skills: [{
          name: 'notion-database-designer',
          interface: {
            display_name: 'Database designer',
            short_description: 'Turns scattered notes',
            icon_small_url: 'https://cdn.example/skill.png',
            icon_large_url: 'javascript:alert(1)',
          },
        }],
      },
    })).toMatchObject({
      apps: [{
        id: 'notion',
        name: 'Notion',
        description: 'Create documentation — Generate PRDs',
        iconUrl: 'https://cdn.example/notion.png',
        iconUrlDark: null,
      }],
      skills: [{
        name: 'notion-database-designer',
        description: 'Turns scattered notes',
        iconUrl: 'https://cdn.example/skill.png',
        iconUrlDark: null,
      }],
    })
  })

  it('keeps detail fields when an installed identity is stamped', () => {
    const detail = parseCodexPluginDetail({
      id: 'plugin_1',
      status: 'ENABLED',
      installation_policy: 'AVAILABLE',
      release: { display_name: 'GitHub', version: '1', interface: { developer_name: 'GitHub' } },
    })!
    const [marked] = applyCodexInstalledCards([detail], [{
      key: 'github@openai-curated-remote',
      remotePluginId: 'plugin_1',
      name: 'github',
    }])
    expect(marked).toMatchObject({
      installed: true,
      installedKey: 'github@openai-curated-remote',
      install: null,
      developerName: 'GitHub',
      version: '1',
    })
    expect(detail.install).not.toBeNull()
  })
})
