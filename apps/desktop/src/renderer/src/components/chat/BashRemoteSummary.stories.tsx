import { useMemo } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createDetailClient } from '@superone/chat-core'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'

const command = `python3 -c "${'print(1);'.repeat(200)}"`
const description = 'Extract native exit, information and ctrl-key logo'
const result = 'Finished extracting assets'

function RemoteBashSummary({ scheme = 'dark', width = 640, withDescription = true, detailState = 'ready' }: {
  scheme?: 'light' | 'dark'
  width?: number
  withDescription?: boolean
  detailState?: 'ready' | 'loading' | 'retry'
}) {
  const client = useMemo(() => {
    const attempts = new Map<string, number>()
    return createDetailClient({
      subscribe: async (target, subscriptionId) => {
        if (detailState === 'loading') return new Promise<never>(() => {})
        const count = attempts.get(target.detailRef) ?? 0
        attempts.set(target.detailRef, count + 1)
        if (detailState === 'retry' && count === 0) throw new Error('Unable to load details')
        return { subscriptionId, revision: 0, offset: 0, text: JSON.stringify({
          input: JSON.stringify({ command, description: withDescription ? description : undefined, timeout: 120000 }), result,
        }) }
      },
      unsubscribe: () => {},
    }, { newId: () => crypto.randomUUID() })
  }, [detailState, withDescription])
  const summary = withDescription ? description : command.slice(0, 160)
  const tool = {
    toolName: 'Bash', toolUseId: 'remote-bash', input: '{}', toolSummary: summary, status: 'complete' as const,
  }
  const message: ChatMessage = {
    id: 'remote-bash-turn', role: 'assistant', providerId: 'claude', status: 'complete', createdAt: '',
    content: [{ type: 'bash', ...tool, remoteDetail: 'phone-bash' }],
  }
  return <div className={`${scheme === 'dark' ? 'dark' : ''} space-y-4 bg-background p-4 text-foreground`} style={{ width }}>
    <DetailScopeProvider scope={{ client, environmentId: 'node', sessionId: 'session' }}>
      <section data-bash-preview="desktop">
        <div className="mb-1 text-xs text-muted-foreground">Desktop</div>
        <ToolBlock {...tool} remoteDetail="desktop-bash" />
      </section>
      <section data-bash-preview="phone">
        <div className="mb-1 text-xs text-muted-foreground">Phone</div>
        <PortableMessage message={message} scheme={scheme} pendingPermission={null} />
      </section>
    </DetailScopeProvider>
  </div>
}

const meta = {
  title: 'Tool UI/Claude Code/Remote Bash Summary',
  component: RemoteBashSummary,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RemoteBashSummary>
export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    for (const section of canvasElement.querySelectorAll<HTMLElement>('[data-bash-preview]')) {
      const header = section.querySelector<HTMLElement>('.tool-node > div')!
      await expect(header).toHaveTextContent(description)
      await userEvent.click(header)
      await waitFor(() => expect(within(section).getByText(result)).toBeVisible())
      await expect(header).toHaveTextContent(description)
    }
  },
}
export const NarrowLight: Story = { args: { width: 320, scheme: 'light' } }
export const CommandOnly: Story = { args: { withDescription: false } }
export const Loading: Story = {
  args: { detailState: 'loading' },
  play: async ({ canvasElement }) => {
    for (const header of canvasElement.querySelectorAll<HTMLElement>('[data-bash-preview] .tool-node > div:first-child')) {
      await userEvent.click(header)
      await expect(header).toHaveTextContent(description)
    }
  },
}
export const FailureAndRetry: Story = {
  args: { detailState: 'retry' },
  play: async ({ canvasElement }) => {
    for (const section of canvasElement.querySelectorAll<HTMLElement>('[data-bash-preview]')) {
      const header = section.querySelector<HTMLElement>('.tool-node > div')!
      await userEvent.click(header)
      await waitFor(() => expect(within(section).getByText(/Unable to load details/)).toBeVisible())
      await expect(header).toHaveTextContent(description)
      await userEvent.click(within(section).getByRole('button', { name: /Retry|重试/ }))
      await waitFor(() => expect(within(section).getByText(result)).toBeVisible())
    }
  },
}
