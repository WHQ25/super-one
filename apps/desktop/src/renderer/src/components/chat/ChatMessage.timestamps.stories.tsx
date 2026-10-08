import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { freshTranscript, localTime, multiDayTranscript, timedAssistant, timedUser } from '@superone/chat-view/fixtures/message-time'
import { dateSeparators } from '@superone/chat-view/presenters/message-time'
import { MessageDateSeparator } from '@superone/chat-view/presenters/MessageTime'
import { ChatMessage } from './ChatMessage'

/** The transcript the way ChatContent draws it: a separator inside the wrapper of the row that opens a day. */
function Transcript({ messages, width = 640 }: { messages: ChatMessageType[]; width?: number }) {
  const separators = dateSeparators(messages, Date.now())
  return (
    <div className="@container mx-auto flex flex-col gap-1" style={{ width, maxWidth: '100%' }}>
      {messages.map((message) => {
        const separatorAt = separators.get(message.id)
        return (
          <div key={message.id} className="chat-message-wrapper">
            {separatorAt !== undefined && <MessageDateSeparator at={separatorAt} />}
            <ChatMessage message={message} sessionStatus="idle" isLastAssistant={false} />
          </div>
        )
      })}
    </div>
  )
}

const multiDay = multiDayTranscript()

const meta = {
  title: 'Chat/Message timestamps',
  component: Transcript,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Date separators open the session (once it is an hour old) and each new calendar day. Hover a user bubble for its send time, '
          + 'or an assistant footer for the turn completion time.',
      },
    },
  },
} satisfies Meta<typeof Transcript>

export default meta
type Story = StoryObj<typeof meta>

/** Three days of turns: a start separator, then one per day. Hover the bubbles and footers. */
export const AcrossDays: Story = { args: { messages: multiDay } }

/** The same transcript in Chinese. */
export const Chinese: Story = { args: { messages: multiDay }, globals: { locale: 'zh' } }

/** A session started minutes ago has no start separator yet. */
export const FreshSession: Story = { args: { messages: freshTranscript() } }

/** A turn saved before completion times were recorded shows no footer time. */
export const TurnWithoutCompletionTime: Story = {
  args: {
    messages: [
      timedUser('u1', 'Summarize the log.', localTime(2, 15, 30)),
      timedAssistant('a1', 'Nothing unusual in the last hour.', localTime(2, 15, 30)),
    ],
  },
}

/** Narrow pane: the separator and hover rows stay on one line. */
export const Narrow: Story = { args: { messages: multiDay, width: 320 } }
