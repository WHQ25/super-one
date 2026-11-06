import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useDraftsStore } from '@/stores/drafts'
import type { DraftListEntry } from '@superone/shared/environment'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { useSidebarFocusStore } from '@/components/sidebar/sidebar-focus'
import { DEFAULT_SIDEBAR_SETTINGS } from '@/lib/multi-host/types'
import { AppSidebar } from './AppSidebar'

const pin = {
  sessionId: 'sidebar-spacing', title: 'Review the sidebar',
  folderPath: '/sidebar-preview', folderName: 'sidebar-preview',
  lastActiveAt: '2026-11-06T00:00:00.000Z', messageCount: 2,
}

const draft: DraftListEntry = {
  id: 'draft-spacing', title: 'Continue reviewing the sidebar', text: 'Continue reviewing the sidebar',
  projectPath: '/sidebar-preview', harness: 'codex', model: null, permissionMode: 'default',
  settings: {}, docJson: null, attachments: [], originSessionId: null, createdAt: '', updatedAt: '',
}

const meta = {
  title: 'Sidebar/AppSidebar',
  component: AppSidebar,
  beforeEach: ({ parameters }) => {
    const previousApp = useAppStore.getState()
    const previousFocus = useSidebarFocusStore.getState()
    const previousCatalog = useMultiHostSidebarStore.getState()
    const previousDrafts = useDraftsStore.getState()
    const originals = [
      ['environment', 'listItems', async () => [{ connectionId: 'preview-node', kind: 'remote', state: 'disconnected', label: 'Build server' }]],
      ['environment', 'listPinnedSessions', async (connectionId: unknown) => parameters.withoutPins || connectionId !== 'local' ? [] : [pin]],
      ['environment', 'listDrafts', async (connectionId: unknown) => parameters.withDrafts && connectionId === 'local' ? [draft] : []],
      ['environment', 'listSessions', async () => []],
      ['miniapp', 'list', async () => []],
      ['app', 'getRecentFolders', async () => []],
      ['app', 'getAppSettings', async () => ({})],
    ].map(([ns, key, fn]) => {
      const namespace = ns as 'environment' | 'miniapp' | 'app'
      const method = key as string
      const original = (window[namespace] as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
      mockIpc(namespace, method, fn as (...args: unknown[]) => unknown)
      return () => mockIpc(namespace, method, original)
    })
    useAppStore.setState({ sidebarTab: 'sessions', currentFolder: null, recentFolders: [], selectedHostConnectionId: 'local', experimentalRemoteNodesEnabled: true })
    useSidebarFocusStore.setState({ target: null })
    useMultiHostSidebarStore.setState({ settings: { ...DEFAULT_SIDEBAR_SETTINGS }, environments: [] })
    useDraftsStore.setState({ byConnection: {}, discardedIds: {}, resumingDraftId: null })
    return () => {
      originals.forEach((restore) => restore())
      useAppStore.setState(previousApp)
      useSidebarFocusStore.setState(previousFocus)
      useMultiHostSidebarStore.setState(previousCatalog)
      useDraftsStore.setState(previousDrafts)
    }
  },
  render: () => <div data-sidebar-inner className="h-[600px] w-72"><AppSidebar /></div>,
} satisfies Meta<typeof AppSidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Pinned: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const heading = canvasElement.querySelector('[data-sidebar-section="pinned"]')!
      const drawer = within(canvasElement).getByRole('button', { name: 'Apps' }).parentElement!
      expect(heading).toBeTruthy()
      expect(drawer).toBeTruthy()
      expect(heading.getBoundingClientRect().top - drawer.getBoundingClientRect().bottom).toBe(8)
    })
  },
}

export const WithoutPinned: Story = {
  parameters: { withoutPins: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const heading = canvasElement.querySelector('[data-slot="environment-section-header"]')!
      const drawer = within(canvasElement).getByRole('button', { name: 'Apps' }).parentElement!
      expect(heading).toBeTruthy()
      expect(drawer).toBeTruthy()
      expect(heading.getBoundingClientRect().top - drawer.getBoundingClientRect().bottom).toBe(8)
    })
  },
}

export const PinnedDark: Story = { ...Pinned, globals: { theme: 'dark' } }
export const PinnedChinese: Story = { ...Pinned, globals: { locale: 'zh' } }

export const Drafts: Story = {
  parameters: { withoutPins: true, withDrafts: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const heading = canvasElement.querySelector('[data-sidebar-section="drafts"]')!
      const drawer = within(canvasElement).getByRole('button', { name: 'Apps' }).parentElement!
      expect(heading).toBeTruthy()
      expect(heading.getBoundingClientRect().top - drawer.getBoundingClientRect().bottom).toBe(8)
    })
  },
}

export const DraftsWithPinned: Story = {
  parameters: { withDrafts: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const heading = canvasElement.querySelector('[data-sidebar-section="drafts"]')!
      const pinned = canvasElement.querySelector('[data-sidebar-section="pinned"]')!
      expect(heading).toBeTruthy()
      expect(pinned).toBeTruthy()
      const rows = pinned.nextElementSibling!
      expect(heading.getBoundingClientRect().top - rows.getBoundingClientRect().bottom).toBe(8)
    })
  },
}

export const DraftsDark: Story = { ...Drafts, globals: { theme: 'dark' } }
export const DraftsChinese: Story = { ...Drafts, globals: { locale: 'zh' } }
