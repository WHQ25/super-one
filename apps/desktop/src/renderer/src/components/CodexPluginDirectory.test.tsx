/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_CURATED_REMOTE_MARKETPLACE, CodexPluginDirectoryError, type CodexPluginDetail, type CodexPluginShelfCard } from '@superone/shared/codex-plugin-shelf'
import { useAppStore } from '@/stores/app'
import { CodexPluginDirectory } from './CodexPluginDirectory'

function card(index: number, overrides: Partial<CodexPluginShelfCard> = {}): CodexPluginShelfCard {
  return {
    id: `plugin_${index}`,
    name: `Plugin ${index}`,
    description: `Description ${index}`,
    iconUrl: `https://cdn.example/${index}.png`,
    iconUrlDark: null,
    install: { pluginName: `plugin_${index}`, remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE },
    installed: false,
    installedKey: null,
    ...overrides,
  }
}

function detailOf(source: CodexPluginShelfCard, overrides: Partial<CodexPluginDetail> = {}): CodexPluginDetail {
  return {
    ...source,
    longDescription: null,
    developerName: null,
    category: null,
    version: null,
    websiteUrl: null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    capabilities: [],
    screenshotUrls: [],
    apps: [],
    skills: [],
    mcpServers: [],
    prompts: [],
    ...overrides,
  }
}

const shelf = [
  card(1, { name: 'Gmail', description: 'Read and manage Gmail', install: null }),
  card(2, { name: 'Health', description: 'Explore your health data' }),
  card(3),
  card(4),
  card(5, { name: 'GitHub', description: 'Triage pull requests', installed: true, installedKey: 'github@openai-curated-remote', install: null }),
  card(6),
  card(7),
  card(8),
  card(9),
]

describe('Codex plugin directory', () => {
  const listDirectory = vi.fn()
  const listCategory = vi.fn()
  const searchPlugins = vi.fn()
  const listPersonal = vi.fn()
  const installTarget = vi.fn()
  const getDetail = vi.fn()

  beforeEach(() => {
    listDirectory.mockReset()
    listCategory.mockReset()
    searchPlugins.mockReset()
    listPersonal.mockReset()
    installTarget.mockReset()
    getDetail.mockReset()
    vi.unstubAllGlobals()
    listDirectory.mockResolvedValue({
      remote: false,
      sections: [{ id: 'featured', title: 'Popular', urlSlug: 'featured', plugins: shelf }],
    })
    listCategory.mockResolvedValue({
      plugins: [card(10, { name: 'Canva', description: 'Create and edit designs' }), ...shelf.slice(6)],
      nextPageToken: null,
      title: 'Popular',
      description: 'Plugins people use most',
      remote: false,
    })
    searchPlugins.mockResolvedValue({ plugins: [], remote: false })
    listPersonal.mockResolvedValue({ plugins: [], remote: false })
    installTarget.mockResolvedValue(undefined)
    getDetail.mockImplementation(async (_project: string, pluginId: string) => ({
      remote: false,
      plugin: detailOf(card(0, { id: pluginId, name: pluginId })),
    }))
    Object.assign(window.app, {
      codexListPluginDirectory: listDirectory,
      codexListPluginCategory: listCategory,
      codexSearchPlugins: searchPlugins,
      codexListPersonalPlugins: listPersonal,
      codexInstallPluginTarget: installTarget,
      codexGetPluginDetail: getDetail,
      cacheRemoteImage: vi.fn(async (url: string) => url),
    })
    useAppStore.setState({ currentFolder: '/project', settingsProvider: 'codex' })
  })

  it('shows six plugins per section and loads the category page', async () => {
    const user = userEvent.setup()
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    expect(await screen.findByText('Health')).toBeInTheDocument()
    expect(screen.getByText('Plugin 6')).toBeInTheDocument()
    expect(screen.queryByText('Plugin 7')).not.toBeInTheDocument()
    expect(screen.queryByText('Canva')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gmail is unavailable' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'GitHub actions' })).toBeInTheDocument()
    expect(listDirectory).toHaveBeenCalledWith('/project')
    expect(searchPlugins).not.toHaveBeenCalled()
    expect(listCategory).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Popular' }))
    expect(await screen.findByText('Canva')).toBeInTheDocument()
    expect(screen.getByText('Plugins people use most')).toBeInTheDocument()
    expect(screen.getByText('Plugin 7')).toBeInTheDocument()
    expect(screen.getByText('Plugin 9')).toBeInTheDocument()
    expect(listCategory).toHaveBeenCalledWith('/project', 'featured', null)
  })

  it('appends the next category page without repeating plugins', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    listCategory.mockImplementation(async (_project: string, _slug: string, pageToken: string | null) => pageToken
      ? {
        plugins: [card(10, { name: 'Canva' }), card(11, { name: 'Dropbox', description: 'Find and share files' })],
        nextPageToken: null,
        title: 'Popular',
        description: null,
        remote: false,
      }
      : {
        plugins: [card(10, { name: 'Canva', description: 'Create and edit designs' })],
        nextPageToken: 'cursor-1',
        title: 'Popular',
        description: null,
        remote: false,
      })
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Popular' }))
    expect(await screen.findByText('Canva')).toBeInTheDocument()
    expect(screen.queryByText('Dropbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load more plugins' }))
    expect(await screen.findByText('Dropbox')).toBeInTheDocument()
    expect(screen.getAllByText('Canva')).toHaveLength(1)
    expect(listCategory).toHaveBeenLastCalledWith('/project', 'featured', 'cursor-1')
  })

  it('loads the next page when the list bottom scrolls into view', async () => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    listCategory.mockImplementation(async (_project: string, _slug: string, pageToken: string | null) => ({
      plugins: [card(pageToken ? 11 : 10, { name: pageToken ? 'Dropbox' : 'Canva' })],
      nextPageToken: pageToken ? null : 'cursor-1',
      title: 'Popular',
      description: null,
      remote: false,
    }))
    const user = userEvent.setup()
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Popular' }))
    expect(await screen.findByText('Dropbox')).toBeInTheDocument()
    expect(listCategory).toHaveBeenLastCalledWith('/project', 'featured', 'cursor-1')
  })

  it('shows a category error and retries the same slug', async () => {
    const user = userEvent.setup()
    listCategory.mockRejectedValueOnce(new Error(CodexPluginDirectoryError.unavailable))
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Popular' }))
    expect(await screen.findByText('Could not load plugins.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Canva')).toBeInTheDocument()
    expect(listCategory).toHaveBeenLastCalledWith('/project', 'featured', null)
  })

  it('refreshes the open category after install', async () => {
    const user = userEvent.setup()
    let installed = false
    listCategory.mockImplementation(async () => ({
      plugins: [card(10, {
        name: 'Canva',
        description: 'Create and edit designs',
        installed,
        installedKey: installed ? 'canva@openai-curated-remote' : null,
        install: installed ? null : { pluginName: 'plugin_10', remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE },
      })],
      nextPageToken: null,
      title: 'Popular',
      description: null,
      remote: false,
    }))
    installTarget.mockImplementation(async () => { installed = true })
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Popular' }))
    await user.click(await screen.findByRole('button', { name: 'Install Canva' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Canva actions' })).toBeInTheDocument())
    expect(installTarget).toHaveBeenCalledWith('/project', {
      pluginName: 'plugin_10',
      remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE,
    })
  })

  it('installs an available plugin by its remote id', async () => {
    const user = userEvent.setup()
    installTarget.mockImplementation(async () => {
      listDirectory.mockResolvedValue({
        remote: false,
        sections: [{
          id: 'featured',
          title: 'Popular',
          urlSlug: 'featured',
          plugins: shelf.map((plugin) => plugin.id === 'plugin_2'
            ? { ...plugin, installed: true, installedKey: 'health@openai-curated-remote', install: null }
            : plugin),
        }],
      })
    })
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByRole('button', { name: 'Install Health' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Health actions' })).toBeInTheDocument())
    expect(installTarget).toHaveBeenCalledWith('/project', {
      pluginName: 'plugin_2',
      remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE,
    })
    expect(getDetail).not.toHaveBeenCalled()
  })

  it('opens a plugin detail page and returns to the same list', async () => {
    const user = userEvent.setup()
    getDetail.mockImplementation(async (_project: string, pluginId: string) => ({
      remote: false,
      plugin: detailOf(pluginId === 'plugin_10' ? card(10, { name: 'Canva', description: 'Create and edit designs' }) : card(2, { name: 'Health', description: 'Explore your health data' }), {
        longDescription: 'Health connects your records.',
        developerName: 'OpenAI',
        category: 'Healthcare',
        version: '1.2.0',
        websiteUrl: 'https://health.example/app',
        privacyPolicyUrl: 'https://privacy.example/policy',
        termsOfServiceUrl: null,
        capabilities: ['Records'],
        apps: [{ id: 'notion', name: 'Notion', description: 'Create documentation', iconUrl: null, iconUrlDark: null }],
        skills: [{ name: 'notion-database-designer', description: 'Turns scattered notes', iconUrl: null, iconUrlDark: null }],
        mcpServers: ['health-mcp'],
        prompts: ['Show my latest record'],
      }),
    }))
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByText('Health'))
    expect(await screen.findByText('Health connects your records.')).toBeInTheDocument()
    expect(screen.getByText('By OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Show my latest record')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Apps 1' })).toBeInTheDocument()
    expect(screen.getByText('Notion')).toBeInTheDocument()
    expect(screen.getByText('Create documentation')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Skills 1' })).toBeInTheDocument()
    expect(screen.getByText('notion-database-designer')).toBeInTheDocument()
    expect(screen.getByText('Turns scattered notes')).toBeInTheDocument()
    expect(screen.getByText('health-mcp')).toBeInTheDocument()
    expect(screen.getByText('Healthcare')).toBeInTheDocument()
    expect(screen.getByText('1.2.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'health.example' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'privacy.example' })).toBeInTheDocument()
    expect(screen.getByText('Records')).toBeInTheDocument()
    const follows = (earlier: HTMLElement, later: HTMLElement) => {
      expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    follows(screen.getByText('Health connects your records.'), screen.getByText('Show my latest record'))
    follows(screen.getByText('Show my latest record'), screen.getByRole('heading', { name: 'Apps 1' }))
    follows(screen.getByRole('heading', { name: 'Apps 1' }), screen.getByRole('heading', { name: 'Skills 1' }))
    follows(screen.getByRole('heading', { name: 'Skills 1' }), screen.getByText('health-mcp'))
    follows(screen.getByText('health-mcp'), screen.getByText('Healthcare'))
    expect(screen.queryByText('Plugin 6')).not.toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledWith('/project', 'plugin_2')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Plugin 6')).toBeInTheDocument()
    expect(screen.queryByText('Health connects your records.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Popular' }))
    await user.click(await screen.findByText('Canva'))
    expect(await screen.findByText('Health connects your records.')).toBeInTheDocument()
    expect(getDetail).toHaveBeenLastCalledWith('/project', 'plugin_10')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Plugins people use most')).toBeInTheDocument()
    expect(screen.queryByText('Health connects your records.')).not.toBeInTheDocument()
  })

  it('keeps the plugin header when detail fails and retries', async () => {
    const user = userEvent.setup()
    getDetail.mockRejectedValueOnce(new Error(CodexPluginDirectoryError.unavailable))
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    await user.click(await screen.findByText('Health'))
    expect(await screen.findByText('Could not load plugins.')).toBeInTheDocument()
    expect(screen.getByText('Explore your health data')).toBeInTheDocument()
    getDetail.mockResolvedValueOnce({
      remote: false,
      plugin: detailOf(card(2, { name: 'Health', description: 'Explore your health data' }), {
        longDescription: 'Health connects your records.',
      }),
    })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Health connects your records.')).toBeInTheDocument()
    expect(screen.queryByText('Could not load plugins.')).not.toBeInTheDocument()
  })

  it('searches when the query is non-empty and shows an empty personal tab', async () => {
    const user = userEvent.setup()
    searchPlugins.mockResolvedValue({
      plugins: [card(20, { name: 'Tripsy', description: 'Plan trips' })],
      remote: false,
    })
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)
    await screen.findByText('Health')

    await user.type(screen.getByRole('textbox', { name: 'Search plugins' }), 'trip')
    expect(await screen.findByText('Tripsy')).toBeInTheDocument()
    expect(screen.queryByText('Health')).not.toBeInTheDocument()
    expect(searchPlugins).toHaveBeenCalledWith('/project', 'trip')

    await user.clear(screen.getByRole('textbox', { name: 'Search plugins' }))
    await user.click(screen.getByRole('tab', { name: 'Personal' }))
    expect(await screen.findByText('No personal plugins')).toBeInTheDocument()
    expect(listPersonal).toHaveBeenCalledWith('/project')
  })

  it('shows a signed-out error and retries', async () => {
    const user = userEvent.setup()
    listDirectory.mockRejectedValueOnce(new Error(CodexPluginDirectoryError.signedOut))
    render(<CodexPluginDirectory onAddMarketplace={() => undefined} />)

    expect(await screen.findByText('Sign in to Codex to browse plugins.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Health')).toBeInTheDocument()
  })
})
