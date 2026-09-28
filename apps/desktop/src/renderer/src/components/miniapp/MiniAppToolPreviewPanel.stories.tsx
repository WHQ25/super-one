import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import type { ToolUiPreview } from '@/stores/miniapp-tool-preview'
import { MiniAppToolPreviewView } from './MiniAppToolPreviewPanel'

/**
 * The WebView itself needs Electron, so these stories cover the host chrome
 * around it: header badges, the width constraint, and the recorded events.
 */
const BASE: ToolUiPreview = {
  key: 'tasks@/Users/me/project',
  appId: 'tasks',
  appName: 'Tasks',
  projectDir: '/Users/me/project',
  projectId: 'project-1',
  tool: 'delete_task',
  toolLabel: 'Delete Task',
  phase: 'result',
  templatePath: 'card.html',
  input: { id: 't1' },
  result: { deleted: true },
  running: false,
  revision: 1,
  events: [],
}

const meta: Meta<typeof MiniAppToolPreviewView> = {
  title: 'Mini Apps/Tool UI Preview',
  component: MiniAppToolPreviewView,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: 520 }}><Story /></div>],
  args: { onEvent: fn() },
}

export default meta
type Story = StoryObj<typeof MiniAppToolPreviewView>

export const Empty: Story = { args: { preview: null } }

export const Result: Story = { args: { preview: BASE } }

export const InterceptWithRecordedEvents: Story = {
  args: {
    preview: {
      ...BASE,
      phase: 'intercept',
      templatePath: 'confirm.html',
      events: [
        { kind: 'cancel', payload: 'User cancelled', at: '2026-09-28T08:00:00.000Z' },
        { kind: 'submit', payload: { confirmed: true, reason: 'duplicate' }, at: '2026-09-28T08:00:05.000Z' },
      ],
    },
  },
}

export const StandaloneRunning: Story = {
  args: {
    preview: { ...BASE, tool: 'increment', toolLabel: 'Increment', phase: 'standalone', templatePath: 'counter.html', result: undefined, running: true },
  },
}

export const NarrowColumn: Story = { args: { preview: { ...BASE, width: 360 } } }

export const LongContent: Story = {
  args: {
    preview: {
      ...BASE,
      toolLabel: 'Synchronize Every Task Across All Connected Workspaces and Calendars',
      appName: 'Task Synchronization Suite With A Very Long Name',
      events: Array.from({ length: 8 }, (_, index) => ({
        kind: 'close' as const,
        payload: { attempt: index, detail: 'x'.repeat(160) },
        at: `2026-09-28T08:00:0${index}.000Z`,
      })),
    },
  },
}
