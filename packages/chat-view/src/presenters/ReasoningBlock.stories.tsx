import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { TranscriptStateProvider } from '@superone/ui/lib/transcript-state'
import { createDetailClient } from '@superone/chat-core'
import { DetailScopeProvider } from '../detail-scope'
import { DeferredReasoning } from '../DeferredReasoning'
import { ReasoningBlock } from './ReasoningBlock'

const REASONING = 'Check the block lifecycle before updating the disclosure state.'

function ReasoningLifecycle({ narrow = false, long = false, autoExpand = false, remote = false }: { narrow?: boolean; long?: boolean; autoExpand?: boolean; remote?: boolean }) {
  const [values] = useState(() => new Map<string, unknown>())
  const [stage, setStage] = useState<'empty' | 'streaming' | 'complete'>('empty')
  const [visible, setVisible] = useState(true)
  const text = stage === 'empty' ? '' : (long ? `${REASONING}\n`.repeat(20) : REASONING)
  const [detailScope] = useState(() => ({
    environmentId: 'remote-node', sessionId: 'session',
    client: createDetailClient({
      subscribe: async (_target, subscriptionId) => ({ subscriptionId, revision: 0, offset: 0, text: REASONING }),
      unsubscribe: () => {},
    }, { newId: () => crypto.randomUUID() }),
  }))
  return (
    <div data-chat-root className="mx-auto w-full space-y-4 p-4" style={{ maxWidth: narrow ? 320 : 640 }}>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border px-2 py-1 text-xs" disabled={stage !== 'empty'} onClick={() => setStage('streaming')}>Start reasoning</button>
        <button className="rounded border px-2 py-1 text-xs" onClick={() => setVisible(value => !value)}>{visible ? 'Hide row' : 'Show row'}</button>
        <button className="rounded border px-2 py-1 text-xs" disabled={stage !== 'streaming'} onClick={() => setStage('complete')}>Finish reasoning</button>
      </div>
      <DetailScopeProvider scope={detailScope}>
        <TranscriptStateProvider values={values} scope="reasoning-story">
          {visible && (remote
            ? <DeferredReasoning text="" remoteDetails={stage === 'empty' ? undefined : ['think']} blockDone={stage === 'complete'} showContent={stage !== 'empty'} autoExpand={autoExpand} />
            : <ReasoningBlock text={text} blockDone={stage === 'complete'} showContent={!!text} autoExpand={autoExpand} />)}
        </TranscriptStateProvider>
      </DetailScopeProvider>
      {stage === 'complete' && <p className="text-sm">The answer follows the completed reasoning.</p>}
    </div>
  )
}

async function completeWhileHidden({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Start reasoning' }))
  await expect(canvasElement.querySelector('.thinking-content')).toBeNull()
  await userEvent.click(canvasElement.querySelector<HTMLElement>('.thinking-node > div')!)
  await expect(canvasElement.querySelector('.thinking-content')).toBeVisible()
  await userEvent.click(canvas.getByRole('button', { name: 'Hide row' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Finish reasoning' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Show row' }))
  await waitFor(() => expect(canvasElement.querySelector('.thinking-content')).toBeNull())

  // A manual expansion of completed reasoning must survive the same remount.
  await userEvent.click(canvasElement.querySelector<HTMLElement>('.thinking-node > div')!)
  await expect(canvasElement.querySelector('.thinking-content')).toBeVisible()
  await userEvent.click(canvas.getByRole('button', { name: 'Hide row' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Show row' }))
  await expect(canvasElement.querySelector('.thinking-content')).toBeVisible()
}

const meta = {
  title: 'Chat/Reasoning lifecycle',
  component: ReasoningLifecycle,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ReasoningLifecycle>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Streaming: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Start reasoning' }))
    await expect(canvasElement.querySelector('.thinking-content')).toBeNull()
  },
}
export const AutoExpandWhileStreaming: Story = {
  args: { autoExpand: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Start reasoning' }))
    await expect(canvasElement.querySelector('.thinking-content')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Finish reasoning' }))
    await expect(canvasElement.querySelector('.thinking-content')).toBeNull()
  },
}
export const CompletionAfterRemount: Story = { play: completeWhileHidden }
export const RemoteAutoExpandWhileStreaming: Story = {
  ...AutoExpandWhileStreaming,
  args: { autoExpand: true, remote: true },
}
export const RemoteCompletionAfterRemount: Story = { args: { remote: true }, play: completeWhileHidden }
export const NarrowLongDarkChinese: Story = {
  args: { narrow: true, long: true },
  globals: { theme: 'dark', locale: 'zh' },
  play: completeWhileHidden,
}
