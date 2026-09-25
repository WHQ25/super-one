/**
 * Storybook: Settings → Harnesses → Hooks tab, for Claude (editable hooks from
 * settings.json) and Codex (read-only hooks discovered by the app-server).
 * Listing, save and delete are mocked in memory.
 */
import type { ReactElement } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import i18n from 'i18next'
import type { CodexHookGroup, CodexHookInfo, HookConfig } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { HooksPage } from './HooksPage'

const HOOKS: HookConfig[] = [
  { id: 'h1', scope: 'user', event: 'PreToolUse', matcher: 'Bash(git push *)', entry: { type: 'command', command: './scripts/check-branch.sh' } },
  { id: 'h2', scope: 'local', event: 'PreToolUse', matcher: 'Edit', entry: { type: 'prompt', prompt: 'Refuse edits to generated files under dist/.' } },
  { id: 'h3', scope: 'user', event: 'PostToolUse', entry: { type: 'http', url: 'https://hooks.example.com/tool-used' } },
  { id: 'h4', scope: 'user', event: 'Stop', entry: { type: 'mcp_tool', server: 'slack', tool: 'post_message' } },
  { id: 'h5', scope: 'user', event: 'SessionStart', entry: { type: 'agent', prompt: 'Summarise open TODOs in the repo.' } },
  { id: 'h6', scope: 'project', event: 'UserPromptSubmit', entry: { type: 'command', command: 'bun run lint --quiet' } },
]

const LONG_HOOKS: HookConfig[] = Array.from({ length: 10 }, (_, i) => ({
  id: `long-${i}`,
  scope: 'user',
  event: i % 2 === 0 ? 'PreToolUse' : 'PostToolUse',
  matcher: 'Bash(npm run build-and-deploy-to-the-production-environment *)',
  entry: {
    type: 'command',
    command: `/Users/demo/Library/Application Support/SuperOne/hooks/enterprise-compliance-audit-logger-with-a-very-long-name-${i}.sh --verbose --format=json --output=/var/log/audit.log`,
  },
}))

const codexHook = (overrides: Partial<CodexHookInfo> & Pick<CodexHookInfo, 'key' | 'eventName'>): CodexHookInfo => ({
  handlerType: 'command',
  matcher: null,
  command: null,
  async: null,
  server: null,
  tool: null,
  additionalContextLimit: null,
  timeoutSec: 60,
  statusMessage: null,
  sourcePath: '/Users/demo/.codex/config.toml',
  source: 'user',
  pluginId: null,
  displayOrder: 0,
  enabled: true,
  isManaged: false,
  trustStatus: 'trusted',
  ...overrides,
})

const CODEX_GROUPS: CodexHookGroup[] = [{
  cwd: '/Users/demo/projects/superone',
  hooks: [
    codexHook({ key: 'c1', eventName: 'preToolUse', matcher: 'shell', command: './scripts/guard.sh' }),
    codexHook({ key: 'c2', eventName: 'preToolUse', handlerType: 'mcpTool', server: 'audit', tool: 'record', source: 'plugin', pluginId: 'audit-kit', trustStatus: 'untrusted', displayOrder: 1 }),
    codexHook({ key: 'c3', eventName: 'stop', command: 'say done', enabled: false, trustStatus: 'unknown' }),
    codexHook({ key: 'c4', eventName: 'sessionStart', command: 'managed-bootstrap', source: 'managed', isManaged: true }),
    codexHook({ key: 'c5', eventName: 'userPromptSubmit', command: 'bun run check', source: 'project', sourcePath: '/Users/demo/projects/superone/.codex/config.toml' }),
  ],
  warnings: ['Hook "legacy-notify" uses a deprecated event name and was skipped.'],
  errors: [],
}]

function seed({ provider = 'claude', hooks = [], codex = [], codexError }: {
  provider?: 'claude' | 'codex'
  hooks?: HookConfig[]
  codex?: CodexHookGroup[] | 'pending'
  codexError?: string
}) {
  return (Story: () => ReactElement) => {
    let current = [...hooks]
    mockIpc('app', 'listHooks', async () => current)
    mockIpc('app', 'saveHook', async () => undefined)
    mockIpc('app', 'deleteHook', async (_pp: unknown, id: unknown) => {
      current = current.filter((h) => h.id !== id)
    })
    mockIpc('app', 'codexListHooks', async () => {
      if (codexError) throw new Error(codexError)
      if (codex === 'pending') return new Promise(() => {})
      return codex
    })
    useAppStore.setState({ settingsProvider: provider, currentFolder: '/Users/demo/projects/superone' })
    useSettingsStore.setState({ hooks: [] })
    return <Story />
  }
}

const meta: Meta<typeof HooksPage> = {
  title: 'Settings/Harnesses/Hooks',
  component: HooksPage,
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

type Story = StoryObj<typeof HooksPage>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

export const Populated: Story = {
  decorators: [seed({ hooks: HOOKS })],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('./scripts/check-branch.sh')).toBeInTheDocument()
  },
}

/** Event groups collapse from their subheader. */
export const CollapsedGroup: Story = {
  decorators: [seed({ hooks: HOOKS })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: /PreToolUse/ }))
    await expect(screen.getByRole('button', { name: /PreToolUse/ })).toHaveAttribute('aria-expanded', 'false')
  },
}

export const Empty: Story = {
  decorators: [seed({})],
}

export const EditorOpen: Story = {
  decorators: [seed({ hooks: HOOKS })],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await screen.findByText('./scripts/check-branch.sh')
    await userEvent.click(screen.getAllByRole('button', { name: i18n.t('resources.hooks.add') })[0])
    await expect(await screen.findByText(i18n.t('resources.hooks.editor.titleNew'))).toBeInTheDocument()
  },
}

export const LongContent: Story = {
  decorators: [seed({ hooks: LONG_HOOKS })],
}

export const Narrow: Story = {
  decorators: [
    seed({ hooks: HOOKS }),
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
}

export const CodexPopulated: Story = {
  decorators: [seed({ provider: 'codex', codex: CODEX_GROUPS })],
}

export const CodexLoading: Story = {
  decorators: [seed({ provider: 'codex', codex: 'pending' })],
}

export const CodexEmpty: Story = {
  decorators: [seed({ provider: 'codex', codex: [] })],
}

export const CodexError: Story = {
  decorators: [seed({ provider: 'codex', codexError: 'codex app-server exited with code 1: failed to parse ~/.codex/config.toml at line 42' })],
}
