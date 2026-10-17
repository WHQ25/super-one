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
  window_mode: { mode: 'mini' },
  resize_window: { width: 1280, height: 900 },
  maximize_split: { target: { environmentId: 'desktop', sessionId: 'artifact' } },
  split_session: { sessionIds: ['voice', 'artifact', 'worker'] },
  close_split: { closeAll: true },
  resize_splits: { dividers: [{ id: 'divider-1', ratio: 0.6 }, { id: 'divider-2', ratio: 0.5 }] },
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

export const MiniWindow: Story = {
  name: 'window_mode · mini',
  args: { params: projected({ action: 'window_mode', mode: 'mini' }) },
}

export const FullWindow: Story = {
  name: 'window_mode · full',
  args: { params: projected({ action: 'window_mode', mode: 'full' }) },
}

export const ResizeWindow: Story = {
  name: 'resize_window · actual clamped dimensions',
  args: { params: projected({ action: 'resize_window', width: 9999, height: 900 }), result: JSON.stringify({ status: 'applied', visible: true, width: 1440, height: 900 }) },
}

export const EnterFullscreen: Story = {
  name: 'enter_fullscreen · in flight',
  args: { params: projected({ action: 'enter_fullscreen' }), isStreaming: true, result: null },
}

export const ExitFullscreen: Story = {
  name: 'exit_fullscreen · applied',
  args: { params: projected({ action: 'exit_fullscreen' }) },
}

export const ResizeWindowChineseDark: Story = {
  ...ResizeWindow,
  name: 'resize_window · narrow Chinese dark',
  globals: { locale: 'zh', theme: 'dark' },
  decorators: [(Story) => <div className="w-[280px]"><Story /></div>],
}

export const WindowModeStreaming: Story = {
  ...MiniWindow,
  name: 'window_mode · in flight',
  args: { ...MiniWindow.args, isStreaming: true, result: null },
}

export const WindowModeSkipped: Story = {
  ...MiniWindow,
  name: 'window_mode · hidden target',
  args: { ...MiniWindow.args, result: SKIPPED },
}

export const WindowModeError: Story = {
  ...MiniWindow,
  name: 'window_mode · native failure',
  args: { ...MiniWindow.args, isError: true, result: 'Native conversion failed' },
}

export const WindowModeDenied: Story = {
  ...MiniWindow,
  name: 'window_mode · denied',
  args: { ...MiniWindow.args, isDenied: true, result: null },
}

export const WindowModeChineseDark: Story = {
  ...FullWindow,
  name: 'window_mode · narrow Chinese dark',
  globals: { locale: 'zh', theme: 'dark' },
  decorators: [(Story) => <div className="w-[280px]"><Story /></div>],
}

export const FocusSession: Story = {
  name: 'focus_session · remote target',
  args: { params: projected({ action: 'focus_session', target: { environmentId: 'node', sessionId: 'worker' } }) },
}

export const NavigationSuperseded: Story = {
  ...FocusSession,
  name: 'focus_session · user navigated away',
  args: { ...FocusSession.args, result: JSON.stringify({ status: 'skipped', visible: false, reason: 'superseded' }) },
}

export const BatchSessions: Story = {
  name: 'split_session · complete batch',
  args: { params: projected({ action: 'split_session', sessionIds: ['voice', 'artifact', { environmentId: 'node', sessionId: 'worker' }] }) },
}

export const ExplicitSessionLayout: Story = {
  name: 'split_session · explicit nested layout',
  args: { params: projected({
    action: 'split_session', sessionIds: ['voice', 'artifact', 'worker', 'review', 'tests'],
    layout: { direction: 'row', ratio: 1 / 3, first: 0, second: { direction: 'row',
      first: { direction: 'column', first: 1, second: 2 }, second: { direction: 'column', first: 3, second: 4 } } },
  }) },
}

export const ExplicitLayoutChineseDark: Story = {
  ...ExplicitSessionLayout,
  name: 'explicit layout · narrow Chinese dark',
  globals: { locale: 'zh', theme: 'dark' },
  decorators: [(Story) => <div className="w-[280px]"><Story /></div>],
}

export const CloseAll: Story = {
  name: 'close_split · closeAll',
  args: { params: projected({ action: 'close_split', closeAll: true }) },
}

export const MaximizeSplit: Story = {
  name: 'maximize_split · saved splits',
  args: { params: projected({ action: 'maximize_split', target: { environmentId: 'desktop', sessionId: 'artifact' } }) },
}

export const RestoreSplits: Story = {
  name: 'restore_splits · restored',
  args: { params: projected({ action: 'restore_splits' }) },
}

export const ResizeSplits: Story = {
  name: 'resize_splits · atomic batch',
  args: { params: projected({ action: 'resize_splits', ...SAMPLE_PARAMS.resize_splits }) },
}

export const RestoreInsufficientSpace: Story = {
  name: 'restore_splits · insufficient space',
  args: { params: projected({ action: 'restore_splits' }), result: 'The proposed proportions cannot fit minimum tile sizes in the current space. Enlarge the window, hide the sidebar, close tiles, or adjust the divider ratios together.', isError: true },
}

export const BatchNarrowChineseDark: Story = {
  ...BatchSessions,
  name: 'batch · narrow Chinese dark',
  globals: { locale: 'zh', theme: 'dark' },
  decorators: [(Story) => <div className="w-[280px]"><Story /></div>],
}

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
