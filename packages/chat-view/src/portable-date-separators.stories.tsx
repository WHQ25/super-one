import { Fragment } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { freshTranscript, multiDayTranscript } from './fixtures/message-time'
import { dateSeparators } from './presenters/message-time'
import { MessageDateSeparator } from './presenters/MessageTime'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'

void initializeChatViewI18n('en')

/** The phone transcript the way ChatView draws it: the separator sits in front of the turn that opens a day. */
function PhoneTranscript({ messages, width = 390 }: { messages: ChatMessage[]; width?: number }) {
  const separators = dateSeparators(messages, Date.now())
  return (
    <div className="space-y-2 p-3" style={{ width }}>
      {messages.map((message) => {
        const separatorAt = separators.get(message.id)
        return (
          <Fragment key={message.id}>
            {separatorAt !== undefined && <MessageDateSeparator at={separatorAt} />}
            <PortableMessage message={message} scheme="dark" pendingPermission={null} sessionStreaming={false} />
          </Fragment>
        )
      })}
    </div>
  )
}

const meta = {
  title: 'Chat/Portable date separators',
  component: PhoneTranscript,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Phone transcript date separators: one at the session start once it is an hour old, then one per new calendar day.',
      },
    },
  },
} satisfies Meta<typeof PhoneTranscript>

export default meta
type Story = StoryObj<typeof meta>

export const AcrossDays: Story = { args: { messages: multiDayTranscript() } }

export const Chinese: Story = { args: { messages: multiDayTranscript() }, globals: { locale: 'zh' } }

export const FreshSession: Story = { args: { messages: freshTranscript() } }

export const Narrow: Story = { args: { messages: multiDayTranscript(), width: 300 } }
