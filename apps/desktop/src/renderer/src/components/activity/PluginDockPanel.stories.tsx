import type { Meta, StoryObj } from '@storybook/react-vite'
import { createSlotRegistry } from '@superone/ui-slots'
import { SlotRegistryProvider } from '@superone/ui-slots/react'
import { PluginDockPanel } from './PluginDockPanel'
import '@/lib/ui-slots'

function makeDockPanelProps(panelKey: string, title: string) {
  return {
    params: { panelKey, pluginId: '@acme/dsh-sample' },
    api: { title } as never,
    containerApi: {} as never,
  }
}

const meta: Meta<typeof PluginDockPanel> = {
  title: 'Activity/PluginDockPanel',
  component: PluginDockPanel,
  decorators: [
    (Story) => (
      <div className="h-[260px] w-[360px] border border-border bg-card">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof PluginDockPanel>

export const UnavailableFallback: Story = {
  args: makeDockPanelProps('sample:missing', 'Missing Plugin Panel'),
}

export const ActivePluginPanel: Story = {
  args: makeDockPanelProps('sample:inspector', 'Sample Inspector'),
  decorators: [
    (Story) => {
      const registry = createSlotRegistry()
      registry.registerKeyed('activity.panel', 'sample:inspector', {
        component: ({ panelKey, title }) => (
          <div className="flex h-full flex-col gap-2 p-3 text-xs">
            <div className="font-medium text-foreground">{title}</div>
            <div className="text-muted-foreground">Key: {panelKey}</div>
          </div>
        ),
      })
      return (
        <SlotRegistryProvider registry={registry}>
          <Story />
        </SlotRegistryProvider>
      )
    },
  ],
}

export const ErrorBoundaryFallback: Story = {
  args: makeDockPanelProps('sample:broken', 'Broken Plugin Panel'),
  decorators: [
    (Story) => {
      const registry = createSlotRegistry()
      registry.registerKeyed('activity.panel', 'sample:broken', {
        component: () => {
          throw new Error('Story error boundary test')
        },
      })
      return (
        <SlotRegistryProvider registry={registry}>
          <Story />
        </SlotRegistryProvider>
      )
    },
  ],
}
