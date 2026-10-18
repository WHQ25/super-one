/**
 * Storybook: Codex curated plugin shelves.
 * IPC is mocked, so sections, search, and install run without a Codex login.
 */
import { useEffect, type ReactElement } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { CodexPluginCategoryResult, CodexPluginDetailResult, CodexPluginDirectoryResult, CodexPluginShelfCard } from '@superone/shared/codex-plugin-shelf'
import { CODEX_CURATED_REMOTE_MARKETPLACE } from '@superone/shared/codex-plugin-shelf'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { CodexPluginDirectory } from './CodexPluginDirectory'

function card(index: number, overrides: Partial<CodexPluginShelfCard> = {}): CodexPluginShelfCard {
  return {
    id: `plugin_${index}`,
    name: `Plugin ${index}`,
    description: `Description ${index}`,
    iconUrl: null,
    iconUrlDark: null,
    install: { pluginName: `plugin_${index}`, remoteMarketplaceName: CODEX_CURATED_REMOTE_MARKETPLACE },
    installed: false,
    installedKey: null,
    ...overrides,
  }
}

const POPULAR: CodexPluginShelfCard[] = [
  card(1, { name: 'Gmail', description: 'Read and manage Gmail', install: null }),
  card(2, { name: 'Google Drive', description: 'Drive, Docs, Sheets or Slides', install: null }),
  card(3, { name: 'Health', description: 'Explore your health data in ChatGPT' }),
  card(4, { name: 'GitHub', description: 'Triage PRs, issues, CI, and publish flows', installed: true, installedKey: 'github@openai-curated-remote', install: null }),
  card(5, { name: 'Supabase', description: 'Manage and query databases' }),
  card(6, { name: 'Outlook Email', description: 'Triage Outlook inboxes' }),
  card(7, { name: 'Hevy', description: 'Interact with your Hevy data' }),
  card(8, { name: 'Tripsy', description: 'Plan and organize your trips' }),
  card(9, { name: 'Sonos', description: 'Control your Sonos system' }),
]

const DIRECTORY: CodexPluginDirectoryResult = {
  remote: false,
  sections: [
    { id: 'featured', title: 'Popular', urlSlug: 'featured', plugins: POPULAR },
    { id: 'new-and-noteworthy', title: 'New & Noteworthy', urlSlug: 'new-and-noteworthy', plugins: POPULAR.slice(0, 6).map((plugin, index) => card(30 + index, { name: `New ${index + 1}`, description: plugin.description })) },
    { id: 'small-business', title: 'Small Business', urlSlug: 'small-business', plugins: [card(40, { name: 'Dropbox', description: 'Find, create, and take action' }), card(41, { name: 'Intuit QuickBooks', description: 'Business finances made simple' })] },
  ],
}

const LONG_NAME = 'International Conference Travel Planner for Distributed Teams and Seasonal Calendars'

const CATEGORY_PAGE: CodexPluginCategoryResult = {
  remote: false,
  title: 'Popular',
  description: 'Plugins people use most',
  nextPageToken: 'next-page',
  plugins: [...POPULAR, card(50, { name: 'Canva', description: 'Create and edit designs' })],
}

function hostedDetail(source: CodexPluginShelfCard): CodexPluginDetailResult {
  return {
    remote: false,
    plugin: {
      ...source,
      longDescription: `${source.name} connects your records.`,
      developerName: 'OpenAI',
      category: 'Healthcare',
      version: '1.2.0',
      websiteUrl: 'https://health.example/app',
      privacyPolicyUrl: 'https://privacy.example/policy',
      termsOfServiceUrl: 'https://terms.example/terms',
      capabilities: ['Records'],
      screenshotUrls: [],
      apps: [{
        id: 'notion',
        name: 'Notion',
        description: 'Create documentation — Generate PRDs, tech specs, and architecture docs',
        iconUrl: null,
        iconUrlDark: null,
      }],
      skills: [{ name: 'notion-database-designer', description: 'Turns scattered notes into trackers', iconUrl: null, iconUrlDark: null }],
      mcpServers: ['health-mcp'],
      prompts: ['Show my latest record'],
    },
  }
}

function seed(
  directory: CodexPluginDirectoryResult | 'pending' | 'error',
  category: CodexPluginCategoryResult | 'pending' | 'error' | 'empty' = CATEGORY_PAGE,
  detail: 'ready' | 'pending' | 'error' = 'ready',
) {
  return (Story: () => ReactElement) => {
    mockIpc('app', 'codexListPluginDirectory', () => directory === 'pending'
      ? new Promise(() => undefined)
      : directory === 'error'
        ? Promise.reject(new Error('codex-plugin-home-unavailable'))
        : Promise.resolve(directory))
    mockIpc('app', 'codexListPluginCategory', async (...args) => {
      const pageToken = args[2]
      if (category === 'pending') return new Promise(() => undefined)
      if (category === 'error') throw new Error('codex-plugin-home-unavailable')
      if (category === 'empty') return { plugins: [], nextPageToken: null, title: 'Popular', description: null, remote: false }
      if (pageToken) {
        return {
          ...category,
          plugins: [card(60, { name: 'Page Two', description: 'Loaded with the next page' })],
          nextPageToken: null,
        }
      }
      return category
    })
    mockIpc('app', 'codexGetPluginDetail', async (...args) => {
      if (detail === 'pending') return new Promise(() => undefined)
      if (detail === 'error') throw new Error('codex-plugin-home-unavailable')
      const id = String(args[1] ?? '')
      const source = [...POPULAR, card(50, { name: 'Canva', description: 'Create and edit designs' })]
        .find((plugin) => plugin.id === id)
        ?? card(1, { id, name: id })
      return hostedDetail(source)
    })
    mockIpc('app', 'codexSearchPlugins', async () => ({ plugins: [], remote: false }))
    mockIpc('app', 'codexListPersonalPlugins', async () => ({ plugins: [], remote: false }))
    mockIpc('app', 'codexInstallPluginTarget', async () => undefined)
    mockIpc('app', 'cacheRemoteImage', async () => null)
    useAppStore.setState({ settingsProvider: 'codex', currentFolder: null })
    return <Story />
  }
}

const meta: Meta<typeof CodexPluginDirectory> = {
  title: 'Settings/Harnesses/Plugins/Codex',
  component: CodexPluginDirectory,
  args: { onAddMarketplace: () => undefined },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-[720px] bg-background px-7 pt-5 pb-8 text-foreground">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof CodexPluginDirectory>
const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

export const Shelves: Story = {
  decorators: [seed(DIRECTORY)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await expect(await screen.findByText('Connect plugins to let Codex work across your tools')).toBeInTheDocument()
    await expect(screen.getByText('Outlook Email')).toBeInTheDocument()
    await expect(screen.queryByText('Hevy')).not.toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'Gmail is unavailable' })).toBeDisabled()
    await expect(screen.getByRole('button', { name: 'GitHub actions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Popular' }))
    await expect(await screen.findByText('Canva')).toBeInTheDocument()
    await expect(screen.getByText('Plugins people use most')).toBeInTheDocument()
    const more = screen.queryByRole('button', { name: 'Load more plugins' })
    if (more) await userEvent.click(more)
    await expect(await screen.findByText('Page Two')).toBeInTheDocument()
  },
}

export const CategoryLoading: Story = {
  decorators: [seed(DIRECTORY, 'pending')],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Popular' }))
    await expect(await screen.findByText('Loading plugins…')).toBeInTheDocument()
  },
}

export const CategoryError: Story = {
  decorators: [seed(DIRECTORY, 'error')],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Popular' }))
    await expect(await screen.findByText('Could not load plugins.')).toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  },
}

export const CategoryEmpty: Story = {
  decorators: [seed(DIRECTORY, 'empty')],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Popular' }))
    await expect(await screen.findByText('No plugins to show')).toBeInTheDocument()
  },
}

async function openHealthDetail(canvasElement: HTMLElement) {
  const screen = body(canvasElement)
  await userEvent.click(await screen.findByRole('button', { name: /Explore your health data/ }))
  return screen
}

export const PluginDetail: Story = {
  decorators: [seed(DIRECTORY)],
  play: async ({ canvasElement }) => {
    const screen = await openHealthDetail(canvasElement)
    await expect(await screen.findByText('Health connects your records.')).toBeInTheDocument()
    await expect(screen.getByText('By OpenAI')).toBeInTheDocument()
    await expect(screen.getByRole('heading', { name: 'Apps 1' })).toBeInTheDocument()
    await expect(screen.getByText('Notion')).toBeInTheDocument()
    await expect(screen.getByRole('heading', { name: 'Skills 1' })).toBeInTheDocument()
    await expect(screen.getByText('notion-database-designer')).toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'health.example' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await expect(screen.getByText('Outlook Email')).toBeInTheDocument()
  },
}

export const PluginDetailLoading: Story = {
  decorators: [seed(DIRECTORY, CATEGORY_PAGE, 'pending')],
  play: async ({ canvasElement }) => {
    const screen = await openHealthDetail(canvasElement)
    await expect(await screen.findByText('Loading plugins…')).toBeInTheDocument()
    await expect(screen.getByText('Health')).toBeInTheDocument()
  },
}

export const PluginDetailError: Story = {
  decorators: [seed(DIRECTORY, CATEGORY_PAGE, 'error')],
  play: async ({ canvasElement }) => {
    const screen = await openHealthDetail(canvasElement)
    await expect(await screen.findByText('Could not load plugins.')).toBeInTheDocument()
    await expect(screen.getByText('Explore your health data in ChatGPT')).toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  },
}

export const PluginDetailNarrow: Story = {
  decorators: [
    seed(DIRECTORY),
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const screen = await openHealthDetail(canvasElement)
    await expect(await screen.findByText('Health connects your records.')).toBeInTheDocument()
  },
}

export const PluginDetailDark: Story = {
  decorators: [
    seed(DIRECTORY),
    (Story) => {
      useEffect(() => {
        document.documentElement.classList.add('dark')
        return () => document.documentElement.classList.remove('dark')
      }, [])
      return (
        <div className="dark bg-background text-foreground">
          <Story />
        </div>
      )
    },
  ],
  play: async ({ canvasElement }) => {
    const screen = await openHealthDetail(canvasElement)
    await expect(await screen.findByText('Health connects your records.')).toBeInTheDocument()
  },
}

export const Loading: Story = {
  decorators: [seed('pending')],
}

export const LoadError: Story = {
  decorators: [seed('error')],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('Could not load plugins.')).toBeInTheDocument()
  },
}

export const Empty: Story = {
  decorators: [seed({ remote: false, sections: [] })],
}

export const PersonalEmpty: Story = {
  decorators: [seed(DIRECTORY)],
  play: async ({ canvasElement }) => {
    await userEvent.click(await body(canvasElement).findByRole('tab', { name: 'Personal' }))
    await expect(await body(canvasElement).findByText('No personal plugins')).toBeInTheDocument()
  },
}

export const SearchEmpty: Story = {
  decorators: [seed(DIRECTORY)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search plugins' }), 'zzzz')
    await expect(await screen.findByText('No plugins match your search')).toBeInTheDocument()
  },
}

export const LongContent: Story = {
  decorators: [seed({
    remote: false,
    sections: [{
      id: 'featured',
      title: 'Popular',
      urlSlug: 'featured',
      plugins: [card(1, { name: LONG_NAME, description: `${LONG_NAME}. ${LONG_NAME}` })],
    }],
  })],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText(LONG_NAME)).toBeInTheDocument()
  },
}

export const Narrow: Story = {
  decorators: [
    seed(DIRECTORY),
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('Health')).toBeInTheDocument()
  },
}

export const Dark: Story = {
  decorators: [
    seed({
      remote: false,
      sections: [{
        id: 'featured',
        title: 'Popular',
        urlSlug: 'featured',
        plugins: [card(1, { name: 'Gmail', description: 'Read and manage Gmail', iconUrl: 'https://cdn.example/light.png', iconUrlDark: 'https://cdn.example/dark.png', install: null })],
      }],
    }),
    (Story) => {
      useEffect(() => {
        document.documentElement.classList.add('dark')
        return () => document.documentElement.classList.remove('dark')
      }, [])
      return (
        <div className="dark bg-background text-foreground">
          <Story />
        </div>
      )
    },
  ],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('Gmail')).toBeInTheDocument()
  },
}
