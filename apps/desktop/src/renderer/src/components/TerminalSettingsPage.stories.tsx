import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { TerminalCommandRule } from '@superone/shared/terminal-command-rules'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { TerminalSettingsPage } from './TerminalSettingsPage'

type Source = { kind: 'ready'; rules: TerminalCommandRule[] } | { kind: 'error' } | { kind: 'pending' }

let source: Source = { kind: 'ready', rules: [] }

mockIpc('terminal', 'listCommandRules', async () => {
  if (source.kind === 'error') throw new Error('database locked')
  if (source.kind === 'pending') return new Promise<never>(() => {})
  return source.rules
})
mockIpc('terminal', 'removeCommandRule', async (projectKey: unknown, pattern: unknown) => {
  if (source.kind !== 'ready') return false
  source = { kind: 'ready', rules: source.rules.filter((r) => !(r.projectKey === projectKey && r.pattern === pattern)) }
  return true
})

const rule = (projectKey: string, pattern: string): TerminalCommandRule => ({
  projectKey,
  pattern,
  createdAt: '2026-09-16T08:00:00.000Z',
})

/**
 * The page reads `listCommandRules` on mount, so a story seeds the shared mock
 * during render — before that effect runs. The custom project name comes from
 * the app store's folder registry, the way the sidebar resolves it.
 */
function seed(next: Source) {
  return (Story: () => ReactElement) => {
    source = next
    useAppStore.setState({
      recentFolders: [
        { id: 'f1', path: '/Users/dev/super-one', name: 'SuperOne', lastOpened: '2026-09-16T08:00:00.000Z', addedAt: '2026-09-16T08:00:00.000Z' },
      ],
    })
    return <Story />
  }
}

const meta: Meta<typeof TerminalSettingsPage> = {
  title: 'Settings/Terminal',
  component: TerminalSettingsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-5xl p-8">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TerminalSettingsPage>

export const Loading: Story = {
  decorators: [seed({ kind: 'pending' })],
}

/** Nothing approved yet — the card explains what would show up here. */
export const Empty: Story = {
  decorators: [seed({ kind: 'ready', rules: [] })],
}

export const LoadError: Story = {
  decorators: [seed({ kind: 'error' })],
}

/**
 * Rules grouped by project. The first project carries the registry's custom
 * name; the remote one shows its node path with a Remote badge; the trash
 * button drops one rule and re-reads the list.
 */
const withRules = seed({
  kind: 'ready',
  rules: [
    rule('/Users/dev/super-one', 'bun run storybook:*'),
    rule('/Users/dev/super-one', 'bun run dev:*'),
    rule('/Users/dev/super-one', 'python3'),
    rule('remote:node-1:/srv/api', 'docker compose -f docker-compose.dev.yml up --build api worker scheduler:*'),
    rule('/Users/dev/some/really/deep/directory/structure/that/goes/on/for/a/while/project-with-a-long-name', 'ssh staging:*'),
  ],
})

export const WithRules: Story = {
  decorators: [withRules],
}

export const Narrow: Story = {
  decorators: [
    withRules,
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
}
