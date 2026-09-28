import type { Meta, StoryObj } from '@storybook/react-vite'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { MiniAppTab, ToolUiPreviewTab } from '@/components/activity/ActivityTab'
import { fakeTabApi } from '@/components/activity/activity-tab-story-api'
import { useMiniAppStore } from '@/stores/miniapp'
import { useToolUiPreviewStore, type ToolUiPreview } from '@/stores/miniapp-tool-preview'

/**
 * A development app's tab while `bun run dev` serves it: the badge follows what
 * the main process answers for `miniapp.devServer`, so each story mocks that.
 */

const DEV_URL = 'http://localhost:5173'
const PREVIEW_KEY = 'storybook-dev-server-preview'

function devApp(id: string, name: string): MiniAppEntry {
  return { id, installDir: `/apps/${id}`, distDir: `/src/${id}/dist`, manifest: { appId: id, name, main: 'node.js', isDev: true } }
}

const APPS: MiniAppEntry[] = [
  devApp('tasks', 'Tasks'),
  devApp('offline', 'Offline'),
  devApp('long', 'Quarterly Revenue Forecast Dashboard'),
  { id: 'installed', installDir: '/apps/installed', manifest: { appId: 'installed', name: 'Installed', main: 'node.js' } },
]

const PREVIEW: ToolUiPreview = {
  key: PREVIEW_KEY,
  appId: 'tasks',
  appName: 'Tasks',
  projectDir: '/projects/demo',
  projectId: null,
  tool: 'show_card',
  toolLabel: 'Show card',
  phase: 'result',
  templatePath: 'card.html',
  input: {},
  running: false,
  revision: 1,
  events: [],
}

const SERVED = new Set(['tasks', 'long', 'installed'])
mockIpc('miniapp', 'devServer', async (appId) => (SERVED.has(appId as string) ? DEV_URL : null))

function Tab({ appId, active = true }: { appId: string; active?: boolean }) {
  const app = APPS.find((a) => a.id === appId)!
  return (
    <MiniAppTab
      {...({ api: fakeTabApi(app.manifest.name, active), params: { instanceKey: `storybook-${appId}`, appId } } as unknown as IDockviewPanelHeaderProps<{ instanceKey: string; appId: string }>)}
    />
  )
}

const meta: Meta = {
  title: 'Mini Apps/Dev Server Badge',
  decorators: [
    (Story) => {
      useMiniAppStore.setState({ apps: APPS })
      useToolUiPreviewStore.setState((s) => ({ previews: { ...s.previews, [PREVIEW_KEY]: PREVIEW } }))
      return (
        <div className="flex h-9 items-center gap-1 bg-background px-2">
          <Story />
        </div>
      )
    },
  ],
}

export default meta
type Story = StoryObj

export const HotReloading: Story = { render: () => <Tab appId="tasks" /> }

export const InactiveTab: Story = { render: () => <Tab appId="tasks" active={false} /> }

/** No reachable dev server: the tab serves the build and shows no badge. */
export const ServingBuild: Story = { render: () => <Tab appId="offline" /> }

/** Installed apps never load from a dev server, whatever is reported. */
export const InstalledApp: Story = { render: () => <Tab appId="installed" /> }

export const LongTitleNarrow: Story = {
  render: () => (
    <div className="w-40">
      <Tab appId="long" />
    </div>
  ),
}

export const ToolUiPreviewTabBadge: Story = {
  render: () => (
    <ToolUiPreviewTab
      {...({ api: fakeTabApi('Tasks · show_card', true), params: { previewKey: PREVIEW_KEY } } as unknown as IDockviewPanelHeaderProps<{ previewKey: string }>)}
    />
  ),
}

export const AllStates: Story = {
  render: () => (
    <>
      <Tab appId="tasks" />
      <Tab appId="offline" active={false} />
      <Tab appId="installed" active={false} />
    </>
  ),
}
