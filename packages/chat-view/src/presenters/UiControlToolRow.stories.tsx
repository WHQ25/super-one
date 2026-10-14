import type { Meta, StoryObj } from '@storybook/react-vite'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { UI_ACT_ACTIONS } from '@superone/shared/ui-control'
import { UiControlToolRow } from './UiControlToolRow'

/**
 * `ui_snapshot` / `ui_act` rows. Params go through the real remote projection, so
 * every story shows what the phone receives; the desktop renders the same row.
 * Results are the handler's real payloads.
 */
function projected(params: Record<string, unknown>): Record<string, unknown> {
  const input = sanitizeRemoteToolInput('mcp__superone__ui_act', JSON.stringify(params))
  return input ? JSON.parse(input) as Record<string, unknown> : {}
}

const APPLIED = JSON.stringify({ status: 'applied', visible: true })
const QUEUED = JSON.stringify({ status: 'queued', visible: false, tab: 'file:src/main.ts' })
const SKIPPED = JSON.stringify({ status: 'skipped', visible: false, reason: 'not_visible' })
const UNSUPPORTED = JSON.stringify({ status: 'unsupported', reason: 'remote_node', message: 'Layout control is only available to sessions running on this desktop.' })
const SNAPSHOT = 'visible: true\nwindow:\n  visible: true\n  sidebar: expanded\n  layout: single\npanel:\n  open: true\n  onScreen: true\n  side: left\n  maximized: false\nterminal:\n  open: false\ntabs[1]{tab,kind,title,active,group,openedBy}:\n  file:src/main.ts,file,main.ts,true,0,agent'

const SAMPLE_PARAMS: Record<string, Record<string, unknown>> = {
  open_file: { path: '/Users/me/project/apps/desktop/src/main/index.ts', line: 3144 },
  open_diff: { commit: '553f7bf6b0c1' },
  focus_tab: { tab: 'file:src/main.ts' },
  close_tab: { tab: 'diff:uncommitted:src/app.ts' },
  split_tab: { tab: 'file:README.md', direction: 'down' },
  maximize_panel: { tab: 'browser-6a0f' },
  panel_side: { side: 'right' },
}

const meta = {
  title: 'Chat/SuperOne/Layout control row',
  component: UiControlToolRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-full max-w-2xl"><Story /></div>],
  args: {
    mcpToolName: 'ui_act',
    params: projected({ action: 'open_file', path: 'src/main.ts', line: 42 }),
    result: APPLIED,
    isStreaming: false,
  },
} satisfies Meta<typeof UiControlToolRow>

export default meta
type Story = StoryObj<typeof meta>

export const OpenFile: Story = { name: 'open_file · applied' }

export const OpenFileStreaming: Story = {
  name: 'open_file · in flight',
  args: { isStreaming: true, result: null },
}

export const OpenUncommittedDiff: Story = {
  name: 'open_diff · uncommitted',
  args: { params: projected({ action: 'open_diff' }) },
}

export const OpenCommitFileDiff: Story = {
  name: 'open_diff · one file of a commit',
  args: { params: projected({ action: 'open_diff', commit: '553f7bf6b0c1', path: 'apps/desktop/src/main/git-run.ts' }) },
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
  name: 'ui_snapshot',
  args: { mcpToolName: 'ui_snapshot', params: {}, result: SNAPSHOT },
}

export const SnapshotStreaming: Story = {
  name: 'ui_snapshot · in flight',
  args: { mcpToolName: 'ui_snapshot', params: {}, result: null, isStreaming: true },
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
      {UI_ACT_ACTIONS.map((action) => (
        <UiControlToolRow key={action} {...args} params={projected({ action, ...SAMPLE_PARAMS[action] })} result={APPLIED} />
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
