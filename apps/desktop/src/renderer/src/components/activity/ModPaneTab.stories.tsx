import type { Meta, StoryObj } from '@storybook/react-vite'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { ModPaneTab } from '@/components/activity/ActivityTab'
import { fakeTabApi } from '@/components/activity/activity-tab-story-api'

/** A Claude Code mod's pane in the activity dock: the same chip as every other activity tab. */

function Tab({ title, active = true }: { title: string; active?: boolean }) {
  return <ModPaneTab {...({ api: fakeTabApi(title, active), params: {} } as unknown as IDockviewPanelHeaderProps)} />
}

const meta: Meta = {
  title: 'Activity/Mod Pane Tab',
  decorators: [
    (Story) => (
      <div className="flex h-9 items-center gap-1 bg-background px-2">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Active: Story = { render: () => <Tab title="Replay Theater" /> }

export const Inactive: Story = { render: () => <Tab title="Blast Radius" active={false} /> }

export const LongTitleNarrow: Story = {
  render: () => (
    <div className="w-40">
      <Tab title="A mod pane whose title is far longer than the tab" />
    </div>
  ),
}
