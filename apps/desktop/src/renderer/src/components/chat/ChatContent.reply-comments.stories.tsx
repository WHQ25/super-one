import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type ReplyComment } from '@/stores/chat'
import { ChatContent } from './ChatContent'

mockTranscriptIpc()

const PROJECT = '__reply_comments__'
const SESSION = 'reply-comments'

const REPLY = [
  '## Root cause',
  '',
  'The transcript is rendered by React and keeps streaming, so wrapping a passage in `<mark>` would hand React text nodes it no longer owns.',
  '',
  '- Find the passage again as a DOM Range whenever rows remount.',
  '- Paint the highlighter strokes on an overlay that scrolls with the transcript.',
  '',
  'Comments ride along with the next turn and their highlights clear once it is sent.',
].join('\n')

const MESSAGES: ChatMessage[] = [
  { id: 'u1', role: 'user', status: 'complete', providerId: 'local', createdAt: '2026-10-19T00:00:00.000Z', content: [{ type: 'text', text: 'Why not reuse the plan marks in chat?' }] },
  { id: 'a1', role: 'assistant', status: 'complete', providerId: 'claude', createdAt: '2026-10-19T00:00:01.000Z', content: [{ type: 'text', text: REPLY }] },
]

const SAVED: ReplyComment[] = [
  { id: 'c1', messageId: 'a1', anchorText: 'would hand React text nodes it no longer owns', quote: 'would hand React text nodes it no longer owns', text: 'Is this only a problem while streaming?' },
  { id: 'c2', messageId: 'a1', anchorText: 'Paint the highlighter strokes on an overlay that scrolls with the transcript.', quote: 'Paint the highlighter strokes on an overlay that scrolls with the transcript.', text: 'Make sure it stays clipped under the composer.' },
]

function ReplyCommentsPreview({ comments, width = 720 }: { comments: ReplyComment[]; width?: number }) {
  const [ready, setReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = useChatStore.getState()
    const previousCatalog = useAppStore.getState().harnessCatalog
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        ...previous.projectSessions,
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: SESSION,
          _sessions: {
            [SESSION]: { ...createDefaultPerSessionState(), cwd: PROJECT, sessionProvider: 'claude', messages: MESSAGES, replyComments: comments },
          },
        },
      },
    })
    useAppStore.setState({ harnessCatalog: null })
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: previousCatalog })
    }
  }, [comments])

  return (
    <TooltipProvider>
      <div className="@container flex h-[520px] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card" style={{ width, maxWidth: '100%' }}>
        {/* ChatContent's own composer shows the comment chips. */}
        {ready && <ChatContent scrollViewportRef={scrollRef} foreground={false} />}
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Chat/Reply Comments',
  component: ReplyCommentsPreview,
  parameters: { layout: 'padded' },
  args: { comments: SAVED },
} satisfies Meta<typeof ReplyCommentsPreview>

export default meta
type Story = StoryObj<typeof meta>

const pins = (canvasElement: HTMLElement) => canvasElement.querySelectorAll('button[data-plan-sticky-ui]')

/** Saved comments: highlighter strokes, numbered pins, and one "2 comments" chip in the composer. */
export const Saved: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(pins(canvasElement)).toHaveLength(2))
  },
}

export const Narrow: Story = { args: { width: 340 } }

/** A lone comment: the chip shows its text and opens its note directly. */
export const Single: Story = { args: { comments: SAVED.slice(0, 1) } }

/** Right-click a selection in the reply → Add Comment: the selection becomes a stroke and a note opens. */
export const AddFromSelection: Story = {
  args: { comments: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const item = await canvas.findByText(/Find the passage again/)
    const text = item.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 'Find the passage again'.length)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))
    await userEvent.click(await within(document.body).findByText('Add Comment'))
    const note = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLTextAreaElement>('textarea[data-plan-draft]')
      expect(el).not.toBeNull()
      return el!
    })
    await waitFor(() => expect(document.activeElement).toBe(note))
    // The note mounts already focused, before user-event can prepare it, so its typing
    // never reaches React; and blurring first would commit the empty draft. Write natively.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Range offsets go stale after a remount.')
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    // The lone comment's chip shows its text.
    await waitFor(() => expect(canvas.getByText('Range offsets go stale after a remount.')).toBeInTheDocument())
  },
}

/** Anything Add to Chat can quote takes a comment: here a selection from the user's message into the reply. */
export const AddAcrossMessages: Story = {
  args: { comments: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const from = (await canvas.findByText('Why not reuse the plan marks in chat?')).firstChild!
    const to = (await canvas.findByText('Root cause')).firstChild!
    const range = document.createRange()
    range.setStart(from, 'Why not '.length)
    range.setEnd(to, 'Root'.length)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    from.parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 120 }))
    await userEvent.click(await within(document.body).findByText('Add Comment'))
    await waitFor(() => expect(canvasElement.querySelector('textarea[data-plan-draft]')).not.toBeNull())
    // One stroke per line: the user's line and the heading.
    await waitFor(() => expect(canvasElement.querySelectorAll('div[aria-hidden][style*="clip-path"]').length).toBeGreaterThanOrEqual(2))
  },
}

/** The composer chip lists the comments; picking one reopens its note on the highlight for editing. */
export const EditFromChip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(pins(canvasElement)).toHaveLength(2))
    await userEvent.click(canvas.getByText('2 comments'))
    await userEvent.click(await within(document.body).findByText('Is this only a problem while streaming?'))
    await waitFor(() => expect(canvasElement.querySelector<HTMLTextAreaElement>('textarea[data-plan-draft]')?.value).toBe('Is this only a problem while streaming?'))
  },
}
