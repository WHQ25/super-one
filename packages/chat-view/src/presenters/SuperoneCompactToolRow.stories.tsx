import type { Meta, StoryObj } from '@storybook/react-vite'
import { SuperoneCompactToolRowPresenter } from './SuperoneCompactToolRow'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'

/**
 * Every state is built from a params object put through the real remote projection,
 * so a story shows what the phone actually receives rather than what the desktop
 * happened to have in hand. A row whose subject is blank here is a projection bug,
 * not a story that forgot an arg.
 */
function projected(mcpToolName: string, params: Record<string, unknown>): Record<string, unknown> {
  const input = sanitizeRemoteToolInput(`mcp__superone__${mcpToolName}`, JSON.stringify(params))
  return input ? JSON.parse(input) as Record<string, unknown> : {}
}

const meta = {
  title: 'Chat/SuperOne/Compact tool row',
  component: SuperoneCompactToolRowPresenter,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-full max-w-2xl"><Story /></div>],
  args: {
    mcpToolName: 'config_read',
    params: projected('config_read', { domain: 'appearance' }),
    result: JSON.stringify({ label: 'Appearance' }),
    isStreaming: false,
  },
} satisfies Meta<typeof SuperoneCompactToolRowPresenter>

export default meta
type Story = StoryObj<typeof meta>

export const SettingsRead: Story = {
  name: 'config_read · domain named by the result',
}

export const SettingsReadStreaming: Story = {
  name: 'config_read · in flight',
  args: { isStreaming: true, result: null },
}

export const SettingsReadOverview: Story = {
  name: 'config_read · no domain falls back to overview',
  args: { params: {}, result: null },
}

export const SettingsReadTruncatedResult: Story = {
  name: 'config_read · result truncated, subject from input',
  args: { result: '{"label":"Appear…' },
}

export const ManualRead: Story = {
  name: 'read_manual · domain/topic',
  args: {
    mcpToolName: 'read_manual',
    params: projected('read_manual', { domain: 'widget', topic: 'mockup' }),
    result: null,
  },
}

export const SessionTag: Story = {
  name: 'session_tag · tag list',
  args: {
    mcpToolName: 'session_tag',
    params: projected('session_tag', { add: ['mobile-ui', 'composer'] }),
    result: null,
  },
}

export const SessionTagBulk: Story = {
  name: 'session_tag · tags plus target count',
  args: {
    mcpToolName: 'session_tag',
    params: projected('session_tag', { add: ['triage'], sessionIds: ['a', 'b', 'c', 'd'] }),
    result: null,
  },
}

export const MiniAppTypes: Story = {
  name: 'miniapp_dev_update_types · directory leaf only',
  args: {
    mcpToolName: 'miniapp_dev_update_types',
    params: projected('miniapp_dev_update_types', { appDir: '/Users/me/Developer/apps/budget-tracker' }),
    result: null,
  },
}

const MINIAPP_OPENED_IN_PIP = JSON.stringify({
  status: 'applied',
  appId: 'budget-tracker',
  name: 'Budget Tracker',
  tab: 'miniapp-budget-tracker:p1',
  shown: 'pip',
  reveal: 'Opened in the background: the user sees it only as a small picture-in-picture over the chat. If they want it in front, call layout_act action=focus_tab tab="miniapp-budget-tracker:p1".',
})

export const MiniAppOpen: Story = {
  name: 'miniapp_open · app named by the result',
  args: {
    mcpToolName: 'miniapp_open',
    params: projected('miniapp_open', { appId: 'budget-tracker' }),
    result: MINIAPP_OPENED_IN_PIP,
  },
}

export const MiniAppOpenStreaming: Story = {
  name: 'miniapp_open · in flight, id until the result names it',
  args: {
    mcpToolName: 'miniapp_open',
    params: projected('miniapp_open', { appId: 'budget-tracker' }),
    result: null,
    isStreaming: true,
  },
}

export const MiniAppOpenNotInstalled: Story = {
  name: 'miniapp_open · error (not installed)',
  args: {
    mcpToolName: 'miniapp_open',
    params: projected('miniapp_open', { appId: 'ghost-app' }),
    result: '[Error] No mini-app ghost-app is installed for this project. Call miniapp_list for installed apps.',
    isError: true,
  },
}

export const MiniAppOpenChinese: Story = {
  ...MiniAppOpen,
  name: 'miniapp_open · Chinese',
  globals: { locale: 'zh' },
}

export const WidgetTemplates: Story = {
  name: 'widget_list_templates · label with no subject',
  args: { mcpToolName: 'widget_list_templates', params: {}, result: null },
}

export const Denied: Story = {
  name: 'Denied · refusal keeps the action verb',
  args: { isDenied: true, result: null },
}

export const Errored: Story = {
  name: 'Error · tone shifts, subject stays',
  args: { isError: true, result: null },
}

export const LongSubject: Story = {
  name: 'Long subject · narrow column',
  decorators: [(Story) => <div className="w-72"><Story /></div>],
  args: {
    mcpToolName: 'session_tag',
    params: projected('session_tag', {
      add: ['mobile-ui', 'composer-layout', 'chat-view-parity', 'remote-projection', 'insight-blocks'],
    }),
    result: null,
  },
}
