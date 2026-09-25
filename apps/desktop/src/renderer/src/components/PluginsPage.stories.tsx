/**
 * Storybook: Settings → Harnesses → Plugins tab (Claude marketplace surface).
 * Every plugin/marketplace IPC is mocked, so rows can be expanded, installed and
 * browsed without a real Claude config directory or network access.
 */
import type { ReactElement } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import i18n from 'i18next'
import type {
  MarketplacePlugin,
  MarketplacePluginDetail,
  PluginDetail,
  PluginInfo,
} from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { PluginsPage } from './PluginsPage'

// --- Fixtures ---

const installed = (overrides: Partial<PluginInfo> & Pick<PluginInfo, 'name' | 'marketplace'>): PluginInfo => ({
  key: `${overrides.name}@${overrides.marketplace}`,
  scope: 'user',
  description: '',
  installPath: `/Users/me/.claude/plugins/${overrides.name}`,
  hasCommands: false,
  hasAgents: false,
  hasSkills: false,
  hasHooks: false,
  hasMcpServers: false,
  hasUpdate: false,
  ...overrides,
})

const available = (overrides: Partial<MarketplacePlugin> & Pick<MarketplacePlugin, 'name' | 'marketplace'>): MarketplacePlugin => ({
  key: `${overrides.name}@${overrides.marketplace}`,
  description: '',
  installed: false,
  ...overrides,
})

const OFFICIAL = {
  marketplace: 'claude-plugins-official',
  marketplaceSource: 'anthropics/claude-plugins-official',
  marketplaceScope: 'official' as const,
  marketplaceLastUpdated: new Date(Date.now() - 3 * 86_400_000).toISOString(),
}
const TEAM = {
  marketplace: 'acme-internal',
  marketplaceSource: '/Users/me/src/acme-plugins',
  marketplaceScope: 'user' as const,
  marketplaceLastUpdated: new Date(Date.now() - 40 * 60_000).toISOString(),
}

const INSTALLED: PluginInfo[] = [
  installed({
    name: 'code-review',
    marketplace: OFFICIAL.marketplace,
    displayName: 'Code Review',
    author: 'Anthropic',
    version: '1.4.0',
    latestVersion: '1.5.0',
    hasUpdate: true,
    description: 'Review the current diff for correctness, security and style issues.',
    hasCommands: true,
    hasAgents: true,
  }),
  installed({
    name: 'pr-toolkit',
    marketplace: OFFICIAL.marketplace,
    author: 'Anthropic',
    version: '0.9.2',
    description: 'Open, describe and babysit pull requests.',
    hasCommands: true,
    hasSkills: true,
    hasHooks: true,
    hasMcpServers: true,
  }),
  installed({
    name: 'release-notes',
    marketplace: TEAM.marketplace,
    author: 'Acme Platform',
    version: '2.0.0',
    description: 'Draft release notes from merged PRs.',
    hasSkills: true,
  }),
]

const MARKETPLACE: MarketplacePlugin[] = [
  available({ ...OFFICIAL, name: 'code-review', displayName: 'Code Review', author: 'Anthropic', version: '1.5.0', installCount: 182_340, installed: true, installedScope: 'user', description: 'Review the current diff for correctness, security and style issues.' }),
  available({ ...OFFICIAL, name: 'pr-toolkit', author: 'Anthropic', version: '0.9.2', installCount: 64_021, installed: true, installedScope: 'user', description: 'Open, describe and babysit pull requests.' }),
  available({ ...OFFICIAL, name: 'frontend-design', author: 'Anthropic', version: '1.0.0', installCount: 41_877, description: 'Distinctive, intentional visual design guidance for new UI.', category: 'Design' }),
  available({ ...OFFICIAL, name: 'security-guidance', author: 'Anthropic', version: '0.3.1', installCount: 12_904, description: 'Warns about risky patterns while editing.' }),
  available({ ...TEAM, name: 'release-notes', author: 'Acme Platform', version: '2.0.0', installed: true, installedScope: 'user', description: 'Draft release notes from merged PRs.' }),
  available({ ...TEAM, name: 'oncall', author: 'Acme SRE', version: '0.1.0', description: 'Pager rotation helpers and runbook lookup.' }),
]

const PLUGIN_FILES: PluginDetail['files'] = [
  { name: 'commands', isDirectory: true, children: [{ name: 'review.md', isDirectory: false }, { name: 'review-security.md', isDirectory: false }] },
  { name: 'agents', isDirectory: true, children: [{ name: 'reviewer.md', isDirectory: false }] },
  {
    name: 'skills',
    isDirectory: true,
    children: [
      { name: 'diff-triage', isDirectory: true, children: [{ name: 'SKILL.md', isDirectory: false }, { name: 'references', isDirectory: true, children: [{ name: 'checklist.md', isDirectory: false }] }] },
    ],
  },
  { name: 'README.md', isDirectory: false },
]

const PLUGIN_DETAIL = (plugin: PluginInfo): PluginDetail => ({
  ...plugin,
  longDescription: `${plugin.description} Runs a focused reviewer agent over the staged diff and reports findings inline.`,
  category: 'Code quality',
  capabilities: ['Interactive', 'Read', 'Write'],
  websiteUrl: 'https://example.com/plugins/code-review',
  privacyPolicyUrl: 'https://example.com/privacy',
  defaultPrompts: ['Review my staged changes', 'Look for security issues in this PR'],
  skills: [
    { name: 'diff-triage', description: 'Sort findings by severity before reporting.', path: 'skills/diff-triage', enabled: true },
    { name: 'style-guide', description: 'Apply the house style guide.', path: 'skills/style-guide', enabled: false },
  ],
  apps: [{ id: 'github', name: 'GitHub', description: 'Post review comments on the PR.', needsAuth: true }],
  mcpServerConfigs: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
  hookEvents: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/lint.sh' }] }] },
  files: PLUGIN_FILES,
})

const FILE_CONTENT = `---
name: review
description: Review the staged diff
---

# Review

Look at \`git diff --staged\` and report **correctness** issues first.
`

const LONG_TEXT = 'An exceptionally thorough plugin description that keeps going to exercise wrapping and clamping on narrow detail columns, including mentions of commands, agents, skills, hooks and MCP servers bundled together in one package.'

const LONG_INSTALLED: PluginInfo[] = [
  ...INSTALLED,
  ...Array.from({ length: 8 }, (_, i) => installed({
    name: `enterprise-compliance-and-governance-toolkit-${i + 1}`,
    marketplace: 'acme-enterprise-compliance-marketplace-with-a-very-long-name',
    author: 'Acme Governance, Risk & Compliance Engineering',
    version: `10.${i}.0-beta.${i + 12}`,
    description: LONG_TEXT,
    hasCommands: true,
    hasAgents: i % 2 === 0,
    hasSkills: true,
    hasHooks: i % 3 === 0,
    hasMcpServers: true,
    hasUpdate: i % 4 === 0,
  })),
]

const LONG_MARKETPLACE: MarketplacePlugin[] = [
  ...MARKETPLACE,
  ...Array.from({ length: 10 }, (_, i) => available({
    marketplace: 'acme-enterprise-compliance-marketplace-with-a-very-long-name',
    marketplaceSource: 'acme-corporation-engineering/enterprise-compliance-marketplace-plugins',
    marketplaceScope: 'user',
    name: `enterprise-compliance-and-governance-toolkit-${i + 1}`,
    author: 'Acme Governance, Risk & Compliance Engineering',
    version: `10.${i}.0-beta.${i + 12}`,
    installCount: 1_000 * (i + 1),
    description: LONG_TEXT,
  })),
]

// Keeps avatars offline: remote logos resolve to an inline placeholder instead of a fetch.
const PLACEHOLDER_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="gray"/></svg>')}`

// --- Mocks ---

interface Seed {
  plugins?: PluginInfo[] | 'pending' | 'error'
  marketplace?: MarketplacePlugin[] | 'pending' | 'error'
  addMarketplaceError?: string
}

const resolveSeed = <T,>(value: T[] | 'pending' | 'error' | undefined) => async (): Promise<T[]> => {
  if (value === 'pending') return new Promise<T[]>(() => {})
  if (value === 'error') throw new Error('Failed to read ~/.claude/plugins/installed_plugins.json')
  return value ?? []
}

function seed({ plugins, marketplace, addMarketplaceError }: Seed) {
  return (Story: () => ReactElement) => {
    const pluginList = Array.isArray(plugins) ? plugins : []
    mockIpc('app', 'listPlugins', resolveSeed(plugins))
    mockIpc('app', 'listMarketplacePlugins', resolveSeed(marketplace))
    mockIpc('app', 'readPlugin', async (_pp: unknown, key: unknown) => {
      const plugin = pluginList.find((p) => p.key === key) ?? pluginList[0]
      return PLUGIN_DETAIL(plugin)
    })
    mockIpc('app', 'readPluginFile', async () => FILE_CONTENT)
    mockIpc('app', 'readMarketplacePlugin', async (mp: unknown, name: unknown): Promise<MarketplacePluginDetail | undefined> => {
      const list = Array.isArray(marketplace) ? marketplace : []
      const plugin = list.find((p) => p.marketplace === mp && p.name === name)
      return plugin && { ...plugin, sourcePath: `/tmp/${plugin.name}`, files: PLUGIN_FILES }
    })
    mockIpc('app', 'readMarketplacePluginFile', async () => FILE_CONTENT)
    mockIpc('app', 'installPlugin', async () => undefined)
    mockIpc('app', 'updatePlugins', async () => undefined)
    mockIpc('app', 'updateMarketplace', async () => undefined)
    mockIpc('app', 'removeMarketplace', async () => undefined)
    mockIpc('app', 'addMarketplace', async () => {
      if (addMarketplaceError) throw new Error(addMarketplaceError)
    })
    mockIpc('app', 'cacheRemoteImage', async () => PLACEHOLDER_LOGO)
    mockIpc('app', 'getGithubStars', async () => 12_480)
    useAppStore.setState({ settingsProvider: 'claude', currentFolder: null })
    useSettingsStore.setState({ plugins: [], marketplacePlugins: [], pluginDetail: null, marketplacePluginDetail: null })
    return <Story />
  }
}

const meta: Meta<typeof PluginsPage> = {
  title: 'Settings/Harnesses/Plugins',
  component: PluginsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // Mirrors the Harnesses detail column, which owns the padding.
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

type Story = StoryObj<typeof PluginsPage>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

async function openInstalledTab(canvasElement: HTMLElement, count: number) {
  const screen = body(canvasElement)
  await userEvent.click(await screen.findByRole('tab', { name: i18n.t('resources.plugins.tabInstalled', { count }) }))
}

export const Marketplaces: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText(OFFICIAL.marketplace)).toBeInTheDocument()
  },
}

export const Loading: Story = {
  decorators: [seed({ plugins: 'pending', marketplace: 'pending' })],
}

export const Empty: Story = {
  decorators: [seed({ plugins: [], marketplace: [] })],
}

/** The page has no load-error surface: a failed read degrades to the empty state. */
export const LoadError: Story = {
  decorators: [seed({ plugins: 'error', marketplace: 'error' })],
}

export const AddMarketplaceError: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE, addMarketplaceError: 'Repository acme/missing-plugins was not found' })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('resources.plugins.addMarketplace') }))
    await userEvent.type(await screen.findByPlaceholderText(i18n.t('resources.plugins.addMarketplaceSourcePlaceholder')), 'acme/missing-plugins')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('resources.plugins.add') }))
    await expect(await screen.findByText('Repository acme/missing-plugins was not found')).toBeInTheDocument()
  },
}

export const Installed: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    await openInstalledTab(canvasElement, INSTALLED.length)
    await expect(await body(canvasElement).findByText(i18n.t('resources.plugins.updateAll'))).toBeInTheDocument()
  },
}

export const InstalledEmpty: Story = {
  decorators: [seed({ plugins: [], marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    await openInstalledTab(canvasElement, 0)
  },
}

export const InstalledExpanded: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await openInstalledTab(canvasElement, INSTALLED.length)
    await userEvent.click(await screen.findByText('Code Review'))
    await userEvent.click(await screen.findByText('review'))
    await expect(await screen.findByText('commands/review.md')).toBeInTheDocument()
  },
}

export const MarketplaceDetail: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText(OFFICIAL.marketplace))
    await expect(await screen.findByPlaceholderText(i18n.t('resources.plugins.searchPlaceholder'))).toBeInTheDocument()
  },
}

export const MarketplacePluginExpanded: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText(OFFICIAL.marketplace))
    await userEvent.click(await screen.findByText('frontend-design'))
    await expect(await screen.findByText('Design')).toBeInTheDocument()
  },
}

export const MarketplaceSearchNoMatch: Story = {
  decorators: [seed({ plugins: INSTALLED, marketplace: MARKETPLACE })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText(OFFICIAL.marketplace))
    await userEvent.type(await screen.findByPlaceholderText(i18n.t('resources.plugins.searchPlaceholder')), 'zzz')
    await expect(await screen.findByText(i18n.t('resources.plugins.searchNoMatch'))).toBeInTheDocument()
  },
}

export const LongContent: Story = {
  decorators: [seed({ plugins: LONG_INSTALLED, marketplace: LONG_MARKETPLACE })],
  play: async ({ canvasElement }) => {
    await openInstalledTab(canvasElement, LONG_INSTALLED.length)
  },
}

export const LongMarketplaceDetail: Story = {
  decorators: [seed({ plugins: LONG_INSTALLED, marketplace: LONG_MARKETPLACE })],
  play: async ({ canvasElement }) => {
    await userEvent.click(await body(canvasElement).findByText('acme-enterprise-compliance-marketplace-with-a-very-long-name'))
  },
}

export const Narrow: Story = {
  decorators: [
    seed({ plugins: LONG_INSTALLED, marketplace: LONG_MARKETPLACE }),
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await openInstalledTab(canvasElement, LONG_INSTALLED.length)
  },
}
