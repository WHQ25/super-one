import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { userEvent, within } from 'storybook/test'
import type { DevRegistryView, MiniAppEntry } from '@superone/shared/miniapp-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { AppsSettingsPage } from './AppsSettingsPage'

const PROJECT = '/Users/dev/super-one'

const tool = (name: string, description: string) => ({ name, description, inputSchema: { type: 'object' } })

const APPS: MiniAppEntry[] = [
  {
    id: 'notes',
    installDir: '/Users/dev/.superone/apps/notes',
    manifest: {
      appId: 'notes',
      name: 'Notes',
      main: 'index.js',
      version: '1.4.0',
      description: 'Quick notes the agent can read and append to while you work.',
      author: { name: 'SuperOne', url: 'https://superone.dev/apps/notes' },
      tools: [
        tool('notes_append', 'Append a line to the current note.'),
        tool('notes_search', 'Full-text search across every note.'),
        tool('notes_delete', 'Delete a note by id.'),
      ],
      permissions: {
        network: [{ domain: 'api.superone.dev', reason: 'Sync notes between your devices.' }],
        media: [{ kind: 'microphone', reason: 'Dictate a note hands-free.' }],
      },
    },
  },
  {
    id: 'kanban',
    installDir: '/Users/dev/.superone/apps/kanban',
    manifest: { appId: 'kanban', name: 'Kanban Board With A Particularly Long Display Name', main: 'index.js', version: '0.9.2' },
  },
  {
    id: 'api-explorer',
    installDir: `${PROJECT}/.superone/apps/api-explorer`,
    manifest: { appId: 'api-explorer', name: 'API Explorer', main: 'index.js', isDev: true, tools: [tool('call_endpoint', 'Call one endpoint.')] },
    orphan: true,
  },
]

const now = Date.parse('2026-09-16T08:00:00.000Z')
const DEV_APPS: DevRegistryView[] = [
  {
    appId: 'api-explorer',
    name: 'API Explorer',
    sourceDir: '/Users/dev/code/miniapps/api-explorer',
    distDir: '/Users/dev/code/miniapps/api-explorer/dist',
    registeredAt: now,
    lastSeenAt: now,
    status: 'ok',
    installations: [{ scope: 'project', projectDir: PROJECT, installDir: `${PROJECT}/.superone/apps/api-explorer`, enabled: true }],
  },
  {
    appId: 'metrics',
    name: 'Metrics Dashboard',
    sourceDir: '/Users/dev/code/miniapps/metrics-dashboard-with-a-very-long-folder-name',
    distDir: '/Users/dev/code/miniapps/metrics/dist',
    registeredAt: now,
    lastSeenAt: now,
    status: 'ok',
    installations: [{ scope: 'user', installDir: '/Users/dev/.superone/apps/metrics', enabled: true }],
  },
  {
    appId: 'old-prototype',
    name: 'Old Prototype',
    sourceDir: '/Users/dev/code/deleted/old-prototype',
    distDir: '/Users/dev/code/deleted/old-prototype/dist',
    registeredAt: now,
    lastSeenAt: now,
    status: 'missing',
    installations: [],
  },
]

type Source = { kind: 'ready'; apps: MiniAppEntry[] } | { kind: 'pending' }

let source: Source = { kind: 'ready', apps: APPS }
let preapproved: Record<string, string[]> = { notes: ['notes_search'] }

mockIpc('miniapp', 'list', async () => (source.kind === 'pending' ? new Promise<never>(() => {}) : source.apps))
mockIpc('miniapp', 'getPreapproved', async (appId: unknown) => preapproved[appId as string] ?? [])
mockIpc('miniapp', 'setPreapproved', async (appId: unknown, tools: unknown) => {
  preapproved = { ...preapproved, [appId as string]: tools as string[] }
})
// `devRegistry` is a namespace object on the preload bridge, not a call.
mockIpc('miniapp', 'devRegistry', {
  list: async () => DEV_APPS,
  add: async () => null,
  install: async () => undefined,
  remove: async () => undefined,
  revealSource: async () => undefined,
} as unknown as (...args: unknown[]) => unknown)

/** Seeds the IPC mocks and stores during render, before the page's refresh effect runs. */
function seed(next: Source) {
  return (Story: () => ReactElement) => {
    source = next
    preapproved = { notes: ['notes_search'] }
    useAppStore.setState({ currentFolder: PROJECT })
    useMiniAppStore.setState({ apps: [], loaded: false })
    return <Story />
  }
}

const populated = seed({ kind: 'ready', apps: APPS })

const meta: Meta<typeof AppsSettingsPage> = {
  title: 'Settings/Apps',
  component: AppsSettingsPage,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof AppsSettingsPage>

export const Loading: Story = { decorators: [seed({ kind: 'pending' })] }

export const Empty: Story = { decorators: [seed({ kind: 'ready', apps: [] })] }

/** Personal and project apps as clickable rows; badges for dev and unlinked apps; long names truncate. */
export const Populated: Story = { decorators: [populated] }

/** The Dev Apps library opens above the lists as its own group: selectable tiles, then the install bar. */
export const DevLibrary: Story = {
  decorators: [populated],
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Dev Apps' }))
    await userEvent.click(await within(canvasElement).findByText('Metrics Dashboard'))
  },
}

/** An app's detail page: tool pre-approval switches, declared permissions, and the uninstall row. */
export const AppDetail: Story = {
  decorators: [populated],
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByText('Notes'))
  },
}

/** Uninstall asks for confirmation inline in the row. */
export const UninstallConfirm: Story = {
  decorators: [populated],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByText('Notes'))
    await userEvent.click(await canvas.findByRole('button', { name: 'Uninstall App' }))
  },
}

export const Dark: Story = {
  decorators: [populated],
  globals: { theme: 'dark' },
}

export const DarkDetail: Story = {
  ...AppDetail,
  globals: { theme: 'dark' },
}

export const Narrow: Story = {
  decorators: [
    populated,
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
}
