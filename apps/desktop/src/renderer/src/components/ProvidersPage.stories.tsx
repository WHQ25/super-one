import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { userEvent, within } from 'storybook/test'
import { BUILTIN_PLATFORMS } from '@superone/shared/platform-registry'
import type { Credential, Platform } from '@superone/shared/platform-registry'
import type { CatalogModel, ModelCatalog } from '@superone/shared/model-catalog-types'
import type { ClaudeAccount, ClaudeRateLimits } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { ProvidersPage } from './ProvidersPage'

/**
 * The Providers settings page: provider list | detail. Platforms, keys, the model catalog and the
 * Claude accounts are answered from fixtures, and key/model edits write to in-memory state, so
 * selecting, toggling and adding are reproducible without real credentials.
 */

const model = (providerId: string, id: string, name: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name,
  providerId,
  inputModalities: ['text'],
  outputModalities: ['text'],
  reasoning: true,
  toolCall: true,
  attachment: false,
  contextWindow: 262144,
  ...extra,
})

const CATALOG: ModelCatalog = {
  generatedAt: '2026-09-24T00:00:00.000Z',
  source: 'cache',
  providers: [
    {
      id: 'xiaomi',
      name: 'Xiaomi',
      env: [],
      npm: '@ai-sdk/anthropic',
      doc: '',
      models: [
        model('xiaomi', 'mimo-v2.6-pro', 'MiMo-V2.6-Pro', { contextWindow: 1048576, releaseDate: '2026-09-22', cost: { input: 0.435, output: 0.87 } }),
        model('xiaomi', 'mimo-v2.6-flash', 'MiMo-V2.6-Flash', { releaseDate: '2026-09-22', inputModalities: ['text', 'image'] }),
        model('xiaomi', 'mimo-v2.5-pro', 'MiMo-V2.5-Pro', { contextWindow: 1048576, releaseDate: '2026-04-22' }),
        model('xiaomi', 'mimo-v2-pro', 'MiMo-V2-Pro', { releaseDate: '2025-12-01', status: 'deprecated' }),
      ],
    },
  ],
}

const RELAY: Platform = {
  id: 'custom:relay',
  brand: 'custom',
  name: 'Team Relay',
  plans: [{ id: 'api', name: 'API', auth: 'api-key', baseUrl: 'https://relay.example.com', endpoints: [] }],
}

const FIXTURE_CREDENTIALS: Credential[] = [
  { id: 'xiaomi-work', platformId: 'xiaomi', planId: 'api', name: 'work', secret: '***abcdef', notes: '', sortOrder: 0, overrides: { anthropic: { models: [{ id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash', tasks: ['chat'] }] } } },
  { id: 'xiaomi-personal', platformId: 'xiaomi', planId: 'api', name: 'personal', secret: '', secretEnv: 'MIMO_API_KEY', notes: '', sortOrder: 1 },
  { id: 'kimi-plus', platformId: 'kimi', planId: 'plus', name: 'Key', secret: '***k3k3k3', notes: '', sortOrder: 0 },
  {
    id: 'relay-default',
    platformId: RELAY.id,
    planId: 'api',
    name: 'default',
    secret: '***relay1',
    baseUrl: 'https://relay.example.com',
    endpoints: [{ id: 'openai', protocols: ['openai-chat'], models: [{ id: 'gpt-relay-large', name: 'Relay Large', tasks: ['chat'] }] }],
    notes: '',
    sortOrder: 0,
  },
]

const CLAUDE_ACCOUNTS: ClaudeAccount[] = [
  { credentialDir: null, loggedIn: true, identityKey: 'dev@example.com|org', email: 'dev@example.com', orgId: 'org', orgName: 'Example Inc.', subscriptionType: 'max', projectsDirectory: null },
  { credentialDir: '/tmp/claude-work', loggedIn: true, identityKey: 'work@example.com|org2', email: 'work@example.com', orgId: 'org2', orgName: null, subscriptionType: 'pro', projectsDirectory: null },
]
const CLAUDE_LIMITS: ClaudeRateLimits = {
  windows: [
    { label: '5-hour', usedPercent: 38, resetsAt: Date.now() + 2 * 3600_000 },
    { label: 'Weekly', usedPercent: 71, resetsAt: Date.now() + 3 * 86400_000 },
  ],
  extraUsage: null,
  planType: 'max',
}

let platforms: Platform[] = []
let credentials: Credential[] = []

mockIpc('app', 'listPlatforms', async () => platforms)
mockIpc('app', 'listCredentials', async () => credentials)
mockIpc('app', 'listBindings', async () => [])
mockIpc('app', 'getModelCatalog', async () => CATALOG)
mockIpc('app', 'refreshModelCatalog', async () => CATALOG)
mockIpc('app', 'updateCredential', async (id: unknown, patch: unknown) => {
  credentials = credentials.map((c) => (c.id === id ? { ...c, ...(patch as Partial<Credential>) } : c))
})
mockIpc('app', 'deleteCredential', async (id: unknown) => {
  credentials = credentials.filter((c) => c.id !== id)
})
mockIpc('app', 'claudeListAccounts', async () => CLAUDE_ACCOUNTS)
mockIpc('app', 'claudeGetRateLimits', async () => CLAUDE_LIMITS)
mockIpc('app', 'openExternalLink', async () => undefined)

function seed(nextPlatforms: Platform[], nextCredentials: Credential[]) {
  return (Story: () => ReactElement) => {
    platforms = nextPlatforms
    credentials = nextCredentials
    useSettingsStore.setState({ providerScope: 'local', platforms: nextPlatforms, credentials: nextCredentials, bindings: [] })
    useChatStore.setState((s) => ({
      harnessResources: { ...s.harnessResources, claude: { ...s.harnessResources.claude, account: CLAUDE_ACCOUNTS[0] } as never },
    }))
    return <Story />
  }
}

const populated = seed([...BUILTIN_PLATFORMS, RELAY], FIXTURE_CREDENTIALS)

/** Opens a provider by its list entry (wordmarks carry no text, so entries are titled by name). */
const open = (name: string) => async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  // An inline SVG `<title>` also matches, so pick the list entry itself.
  const matches = await within(canvasElement).findAllByTitle(name)
  await userEvent.click(matches.find((el) => el.tagName === 'BUTTON') ?? matches[0])
}

const meta: Meta<typeof ProvidersPage> = {
  title: 'Settings/ProvidersPage',
  component: ProvidersPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-[860px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ProvidersPage>

/** Nothing selected yet: the list groups providers by Enabled / Disabled and the detail shows a hint. */
export const SelectHint: Story = { decorators: [populated] }

/** No platforms loaded: an empty list and the hint. */
export const Empty: Story = { decorators: [seed([], [])] }

/** A builtin provider with two plans, two keys (one from an env var) and an enabled model. */
export const BuiltinWithKeys: Story = { decorators: [populated], play: open('Xiaomi MiMo') }

/** Advanced opened: the endpoint picker and its route / mapping / env rows on one card. */
export const BuiltinAdvancedOpen: Story = {
  decorators: [populated],
  play: async (ctx) => {
    await open('Xiaomi MiMo')(ctx)
    await userEvent.click(await within(ctx.canvasElement).findByRole('button', { name: /advanced/i }))
  },
}

/** A provider without keys opens on the new-key form; plans switch from the header. */
export const BuiltinNoKey: Story = { decorators: [populated], play: open('GLM (CN)') }

/** A custom relay: editable name and icon, a Base URL row above its keys, discovered models. */
export const CustomPlatform: Story = { decorators: [populated], play: open('Team Relay') }

/** Official Claude: one row per signed-in account with its usage meters, plus an add row. */
export const OfficialClaude: Story = { decorators: [populated], play: open('Claude') }

/** The add-custom form from the list header's "+" button. */
export const AddCustom: Story = {
  decorators: [populated],
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: /add custom provider/i }))
  },
}

/** Narrow window: the list keeps its width and the detail column wraps. */
export const Narrow: Story = {
  decorators: [populated, (Story) => <div className="h-full w-[760px]"><Story /></div>],
  play: open('Xiaomi MiMo'),
}
