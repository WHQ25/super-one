import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { OpenCodeResources } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { OpenCodeModelSelector } from './OpenCodeModelSelector'
const catalog: OpenCodeResources = {
  models: [{ id: 'openai/gpt-6-astra', name: 'GPT 6 Astra', description: 'Model catalog fixture' }, { id: 'opencode/big-pickle', name: 'Big Pickle', description: 'Model catalog fixture' }],
  agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }], commands: [],
}
function RefreshStory({ empty = false, fail = false, narrow = false }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState().harnessResources
    const app = window.app
    window.app = { ...app, connectOpenCode: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      if (fail) throw new Error('Storybook offline fixture')
      return catalog
    } } as typeof window.app
    useChatStore.setState({ harnessResources: { ...previous, opencode: empty ? { models: [], agents: [], commands: [] } : catalog } })
    setReady(true)
    return () => {
      useChatStore.setState({ harnessResources: previous })
      if (app) window.app = app
      else delete (window as Partial<Window>).app
    }
  }, [empty, fail])
  return <div className="flex min-h-80 items-end rounded-lg border bg-background p-4" style={{ width: narrow ? 280 : 480 }}>
    {ready && <OpenCodeModelSelector />}
    <Toaster />
  </div>
}
const meta: Meta<typeof OpenCodeModelSelector> = {
  title: 'Chat/OpenCodeModelSelector', component: OpenCodeModelSelector, parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof OpenCodeModelSelector>
export const ManualRefresh: Story = { render: () => <RefreshStory /> }
export const EmptyCatalog: Story = { render: () => <RefreshStory empty /> }
export const FailedRefresh: Story = { render: () => <RefreshStory fail /> }
export const Narrow: Story = { render: () => <RefreshStory narrow /> }
