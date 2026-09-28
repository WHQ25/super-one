import type { Meta, StoryObj } from '@storybook/react-vite'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { BrowserTab } from '@/components/activity/ActivityTab'
import { fakeTabApi } from '@/components/activity/activity-tab-story-api'
import { registerBrowserWebview } from '@/components/browser/browser-host-api'
import { useBrowserStore, type BrowserTabState } from '@/stores/browser'

/**
 * The speaker on a browser tab: it appears while the page makes sound and toggles
 * the tab's mute. Each tab is backed by a stand-in webview so the toggle works
 * without a real guest page.
 */

const TABS: Record<string, Pick<BrowserTabState, 'title' | 'audible' | 'muted'>> = {
  silent: { title: 'Documentation', audible: false, muted: false },
  playing: { title: 'Lo-fi Radio', audible: true, muted: false },
  muted: { title: 'Autoplay News', audible: true, muted: true },
  'muted-quiet': { title: 'Paused Video', audible: false, muted: true },
  long: { title: 'A Very Long Livestream Title That Will Not Fit In The Tab', audible: true, muted: false },
}

for (const id of Object.keys(TABS)) {
  registerBrowserWebview(id, { setAudioMuted: () => {} } as unknown as Electron.WebviewTag)
}

function Tab({ id, active = true }: { id: string; active?: boolean }) {
  return (
    <BrowserTab
      {...({ api: fakeTabApi(TABS[id].title, active), params: { browserId: id } } as unknown as IDockviewPanelHeaderProps<{ browserId: string }>)}
    />
  )
}

const meta: Meta = {
  title: 'Browser/Tab Audio',
  decorators: [
    (Story) => {
      const store = useBrowserStore.getState()
      for (const [id, state] of Object.entries(TABS)) {
        store.ensure(id, `https://${id}.example.com`)
        store.patch(id, state)
      }
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

/** No sound, no mute: the tab looks exactly as before. */
export const Silent: Story = { render: () => <Tab id="silent" /> }

/** Click the speaker to mute, click again to restore. */
export const Playing: Story = { render: () => <Tab id="playing" /> }

export const Muted: Story = { render: () => <Tab id="muted" /> }

/** Muted and quiet: the icon stays so the tab is still one click from unmuting. */
export const MutedWhileQuiet: Story = { render: () => <Tab id="muted-quiet" /> }

/** Background tabs show the speaker too — finding the noisy tab is the point. */
export const InactivePlaying: Story = { render: () => <Tab id="playing" active={false} /> }

export const LongTitleNarrow: Story = {
  render: () => (
    <div className="w-40">
      <Tab id="long" />
    </div>
  ),
}

export const AllStates: Story = {
  render: () => (
    <>
      <Tab id="silent" active={false} />
      <Tab id="playing" />
      <Tab id="muted" active={false} />
      <Tab id="long" active={false} />
    </>
  ),
}
