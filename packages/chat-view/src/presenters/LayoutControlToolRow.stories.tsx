import type { Meta, StoryObj } from '@storybook/react-vite'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { LAYOUT_ACT_ACTIONS } from '@superone/shared/layout-control'
import { LayoutControlToolRow } from './LayoutControlToolRow'

/**
 * `layout_snapshot` / `layout_act` rows. Params go through the real remote projection, so
 * every story shows what the phone receives; the desktop renders the same row.
 * Results are the handler's real payloads.
 */
function projected(params: Record<string, unknown>): Record<string, unknown> {
  const input = sanitizeRemoteToolInput('mcp__superone__layout_act', JSON.stringify(params))
  return input ? JSON.parse(input) as Record<string, unknown> : {}
}

const APPLIED = JSON.stringify({ status: 'applied', visible: true })
const QUEUED = JSON.stringify({ status: 'queued', visible: false, tab: 'file:src/main.ts' })
const SKIPPED = JSON.stringify({ status: 'skipped', visible: false, reason: 'not_visible' })
const UNSUPPORTED = JSON.stringify({ status: 'unsupported', reason: 'remote_node', message: 'Layout control is only available to sessions running on this desktop.' })
const SNAPSHOT = 'visible: true\nwindow:\n  visible: true\n  sidebar: expanded\n  layout: single\npanel:\n  open: true\n  onScreen: true\n  side: left\n  maximized: false\nterminal:\n  open: false\nchatMode: docked\nchatPosition: bottom-right\nsizes:\n  window: 1600\n  sidebar:\n    width: 320\n    min: 320\n    max: 500\n  panel:\n    width: 560\n    min: 400\n    max: 908\n  chat:\n    width: 708\n    min: 360\ngroups[1]{group,x,y,width,height}:\n  0,0,0,560,800\ntabs[1]{tab,kind,title,active,group,openedBy}:\n  file:src/main.ts,file,main.ts,true,0,agent'

const SAMPLE_PARAMS: Record<string, Record<string, unknown>> = {
  open_file: { path: '/Users/me/project/apps/desktop/src/main/index.ts', line: 3144 },
  focus_tab: { tab: 'file:src/main.ts' },
  close_tab: { tab: 'file:src/app.ts' },
  move_tab: { tab: 'file:README.md', direction: 'down' },
  resize_group: { width: 640, height: 360 },
  maximize_panel: { tab: 'browser-6a0f' },
  panel_side: { side: 'right' },
  resize_sidebar: { width: 400 },
  resize_panel: { width: 720 },
  chat_mode: { mode: 'floating', position: 'top-right' },
}

const meta = {
  title: 'Chat/SuperOne/Layout control row',
  component: LayoutControlToolRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-full max-w-2xl"><Story /></div>],
  args: {
    mcpToolName: 'layout_act',
    params: projected({ action: 'open_file', path: 'src/main.ts', line: 42 }),
    result: APPLIED,
    isStreaming: false,
  },
} satisfies Meta<typeof LayoutControlToolRow>

export default meta
type Story = StoryObj<typeof meta>

export const OpenFile: Story = { name: 'open_file · applied' }

export const OpenFileStreaming: Story = {
  name: 'open_file · in flight',
  args: { isStreaming: true, result: null },
}

export const Queued: Story = {
  name: 'background session · queued for later',
  args: { result: QUEUED },
}

export const Skipped: Story = {
  name: 'background session · window-wide change skipped',
  args: { params: projected({ action: 'hide_sidebar' }), result: SKIPPED },
}

export const Unsupported: Story = {
  name: 'remote node · unsupported',
  args: { params: projected({ action: 'show_panel' }), result: UNSUPPORTED },
}

export const ResizeClamped: Story = {
  name: 'resize_panel · clamped to what the chat can spare',
  args: { params: projected({ action: 'resize_panel', width: 5000 }), result: JSON.stringify({ status: 'applied', visible: true, width: 908 }) },
}

export const ErrorNotOwned: Story = {
  name: 'close_tab · error (not opened by the agent)',
  args: {
    params: projected({ action: 'close_tab', tab: 'browser-6a0f' }),
    result: 'Tab browser-6a0f was not opened by you; only tabs you opened can be closed.',
    isError: true,
  },
}

export const Denied: Story = {
  name: 'split_session · denied',
  args: { params: projected({ action: 'split_session', sessionId: 'c1' }), result: 'Permission denied', isDenied: true },
}

export const Snapshot: Story = {
  name: 'layout_snapshot',
  args: { mcpToolName: 'layout_snapshot', params: {}, result: SNAPSHOT },
}

export const SnapshotStreaming: Story = {
  name: 'layout_snapshot · in flight',
  args: { mcpToolName: 'layout_snapshot', params: {}, result: null, isStreaming: true },
}

export const LongPathNarrow: Story = {
  name: 'long path, queued, narrow',
  args: {
    params: projected({ action: 'open_file', path: '/Users/me/project/packages/shared/src/environment/host-action-a-very-long-descriptor-family-name-that-keeps-going.ts', line: 12 }),
    result: QUEUED,
  },
  decorators: [(Story) => <div className="w-[300px]"><Story /></div>],
}

/** Every action's done label and subject, the way a long agent turn lists them. */
export const AllActions: Story = {
  name: 'every action · done',
  render: (args) => (
    <div className="flex flex-col gap-1">
      {LAYOUT_ACT_ACTIONS.map((action) => (
        <LayoutControlToolRow key={action} {...args} params={projected({ action, ...SAMPLE_PARAMS[action] })} result={APPLIED} />
      ))}
    </div>
  ),
}

export const AllActionsChinese: Story = {
  ...AllActions,
  name: 'every action · Chinese',
  globals: { locale: 'zh' },
}

export const AllActionsDark: Story = {
  ...AllActions,
  name: 'every action · dark',
  globals: { theme: 'dark' },
}
