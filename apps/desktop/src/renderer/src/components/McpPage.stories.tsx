/**
 * Storybook: Settings → Harnesses → MCP tab, including the server detail view,
 * the add-server form and the library picker. Config reads, health checks and
 * toggles are mocked, so no MCP server is spawned.
 */
import type { ReactElement } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import i18n from 'i18next'
import type { McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta } from '@superone/shared/agent-types'
import type { McpbInstalledEntry } from '@superone/shared/mcpb-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { McpPage } from './McpPage'

const CONFIGS: McpServerConfig[] = [
  { name: 'filesystem', type: 'stdio', scope: 'user', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/demo'], env: { LOG_LEVEL: 'info' } },
  { name: 'github', type: 'http', scope: 'user', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ••••' } },
  { name: 'linear', type: 'sse', scope: 'user', url: 'https://mcp.linear.app/sse' },
  { name: 'postgres', type: 'stdio', scope: 'user', command: 'uvx', args: ['mcp-server-postgres'], disabled: true },
  { name: 'demo-bundle', type: 'stdio', scope: 'user', command: 'node', args: ['server/index.js'] },
  { name: 'repo-tools', type: 'stdio', scope: 'project', command: 'bun', args: ['run', 'mcp'] },
]

const TOOLS = [
  { name: 'read_file', description: 'Read the complete contents of a file from the file system.' },
  { name: 'write_file', description: 'Create a new file or overwrite an existing file.' },
  { name: 'list_directory' },
]

const STATUS: McpServerInfo[] = [
  { name: 'filesystem', scope: 'user', status: 'connected', toolCount: 3, tools: TOOLS },
  { name: 'github', scope: 'user', status: 'needs-auth', error: 'HTTP 401', toolCount: 0, tools: [] },
  { name: 'linear', scope: 'user', status: 'failed', error: 'spawn ECONNREFUSED 127.0.0.1:443 — the server closed the connection before completing the MCP initialize handshake', toolCount: 0 },
  { name: 'postgres', scope: 'user', status: 'disabled', toolCount: 0 },
  { name: 'demo-bundle', scope: 'user', status: 'pending', toolCount: 0 },
  { name: 'Gmail', scope: 'claudeai', status: 'connected', toolCount: 12, tools: [{ name: 'search_threads', description: 'Search Gmail threads.' }] },
  { name: 'Google Drive', scope: 'claudeai', status: 'disabled', toolCount: 0 },
]

const META: Record<string, McpServerMeta> = {
  filesystem: { name: 'filesystem', description: 'Secure file operations with configurable access controls', tools: TOOLS },
}

const BUNDLES: McpbInstalledEntry[] = [
  {
    meta: {
      name: 'demo-bundle',
      version: '1.2.0',
      installedAt: new Date().toISOString(),
      provider: 'claude',
      scope: 'user',
      manifestHash: 'abc',
      userConfigPlain: {},
      userConfigSensitiveKeys: [],
    },
    installDir: '/Users/demo/.superone/mcpb/demo-bundle',
  },
]

const LIBRARY: McpLibraryEntry[] = [
  { name: 'filesystem', type: 'stdio', command: 'npx', savedAt: new Date().toISOString() },
  { name: 'sentry', type: 'http', url: 'https://mcp.sentry.dev/mcp', savedAt: new Date().toISOString() },
  { name: 'context7', type: 'http', url: 'https://mcp.context7.com/mcp', savedAt: new Date().toISOString() },
  { name: 'playwright', type: 'stdio', command: 'npx', savedAt: new Date().toISOString() },
  { name: 'a-server-with-a-rather-long-name', type: 'stdio', command: 'npx', savedAt: new Date().toISOString() },
]

const LONG_CONFIGS: McpServerConfig[] = Array.from({ length: 12 }, (_, i) => ({
  name: `enterprise-knowledge-base-connector-for-compliance-${i + 1}`,
  type: 'stdio',
  scope: 'user',
  command: 'npx',
}))

const LONG_STATUS: McpServerInfo[] = LONG_CONFIGS.map((c, i) => ({
  name: c.name,
  scope: 'user',
  status: i % 3 === 0 ? 'failed' : 'connected',
  error: 'Error: Connection closed while waiting for the initialize response from the MCP server process (exit code 1)',
  toolCount: 42,
}))

interface Seed {
  provider?: 'claude' | 'codex' | 'dsh'
  configs?: McpServerConfig[]
  status?: McpServerInfo[]
  meta?: Record<string, McpServerMeta>
  library?: McpLibraryEntry[]
  bundles?: McpbInstalledEntry[]
  /** Keep the health check pending so the claude.ai section shows its loading row. */
  checking?: boolean
}

function seed({ provider = 'claude', configs = [], status = [], meta = {}, library = [], bundles = [], checking }: Seed) {
  return (Story: () => ReactElement) => {
    let current = configs.map((c) => ({ ...c }))
    const toggle = async (_pp: unknown, name: unknown, disabled: unknown) => {
      current = current.map((c) => (c.name === name ? { ...c, disabled: Boolean(disabled) } : c))
    }
    mockIpc('app', 'listMcpConfigs', async () => current)
    mockIpc('app', 'codexListMcpConfigs', async () => current)
    mockIpc('app', 'dshListMcpConfigs', async () => current)
    mockIpc('app', 'codexGetMcpStatus', async () => status)
    mockIpc('app', 'checkMcpServers', async () => (checking ? new Promise(() => {}) : { status, meta }))
    mockIpc('app', 'listMcpLibrary', async () => library)
    mockIpc('app', 'listInstalledMcpb', async () => bundles)
    mockIpc('app', 'toggleMcpConfig', toggle)
    mockIpc('app', 'codexToggleMcpConfig', toggle)
    mockIpc('app', 'dshToggleMcpConfig', toggle)
    mockIpc('app', 'saveMcpConfig', async () => undefined)
    mockIpc('app', 'deleteMcpConfig', async () => undefined)
    mockIpc('app', 'deleteMcpLibraryEntry', async () => undefined)
    mockIpc('app', 'oauthAuthorize', async () => ({}))
    mockIpc('app', 'revealMcpb', async () => undefined)
    useAppStore.setState({ settingsProvider: provider, currentFolder: '/Users/demo/projects/superone' })
    useSettingsStore.setState({
      mcpConfigs: [],
      mcpStatus: [],
      mcpMeta: {},
      codexMcpConfigs: [],
      codexMcpStatus: [],
      dshMcpConfigs: [],
      mcpLibrary: [],
      mcpbInstalled: [],
      selectedMcpName: null,
    })
    return <Story />
  }
}

const meta: Meta<typeof McpPage> = {
  title: 'Settings/Harnesses/MCP',
  component: McpPage,
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

type Story = StoryObj<typeof McpPage>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

const POPULATED: Seed = { configs: CONFIGS, status: STATUS, meta: META, library: LIBRARY, bundles: BUNDLES }

/** Connected, needs-auth, failed (long error), disabled, pending and bundle rows, plus the claude.ai section. */
export const Populated: Story = {
  decorators: [seed(POPULATED)],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('Gmail')).toBeInTheDocument()
  },
}

export const ClaudeAiLoading: Story = {
  decorators: [seed({ ...POPULATED, checking: true })],
}

export const Codex: Story = {
  decorators: [seed({ provider: 'codex', configs: CONFIGS, status: STATUS.filter((s) => s.scope !== 'claudeai') })],
}

export const Empty: Story = {
  decorators: [seed({})],
}

export const AddServerForm: Story = {
  decorators: [seed(POPULATED)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await screen.findByText('filesystem')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('resources.mcp.add') }))
    await expect(await screen.findByText(i18n.t('resources.mcp.form.title'))).toBeInTheDocument()
  },
}

export const Library: Story = {
  decorators: [seed(POPULATED)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('resources.mcp.library') }))
    await userEvent.click(await screen.findByText('sentry'))
    await expect(await screen.findByText(i18n.t('resources.mcp.libraryView.title'))).toBeInTheDocument()
  },
}

export const ServerDetail: Story = {
  decorators: [seed(POPULATED)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText('filesystem'))
    await expect(await screen.findByText(i18n.t('resources.mcp.detail.configuration'))).toBeInTheDocument()
  },
}

export const ServerDetailNeedsAuth: Story = {
  decorators: [seed(POPULATED)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText('github'))
    await expect(await screen.findByText(i18n.t('resources.mcp.detail.authTitle'))).toBeInTheDocument()
  },
}

export const ClaudeAiDetail: Story = {
  decorators: [seed(POPULATED)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText('Gmail'))
    await expect(await screen.findByText('search_threads')).toBeInTheDocument()
  },
}

export const LongContent: Story = {
  decorators: [seed({ configs: LONG_CONFIGS, status: LONG_STATUS })],
}

export const Narrow: Story = {
  decorators: [
    seed(POPULATED),
    (Story) => (
      <div className="max-w-[480px]">
        <Story />
      </div>
    ),
  ],
}
