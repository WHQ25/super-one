import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { installFakeNativeHost } from './fixtures/native-host'
import { userBubbleGoalMessage, userBubbleLegacyPasteMessage, userBubbleMessage } from './fixtures/user-bubble'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'

void initializeChatViewI18n('en')

const BOARD_ICON = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

/**
 * The phone's user bubble, drawn by the shared presenter with the phone's
 * ports. Taps go to a fake native shell; the last request shows below, so
 * opening a file, a picture or copying is visible without a device.
 */
function PhoneBubble({ message, width = 390, scheme = 'light' }: { message: ChatMessage; width?: number; scheme?: 'light' | 'dark' }) {
  const [lastRequest, setLastRequest] = useState('—')
  useEffect(() => installFakeNativeHost((request, reply) => {
    setLastRequest(`${request.action} ${JSON.stringify(request.payload ?? {})}`)
    reply(request.action === 'loadAttachment' ? { result: { dataUri: 'data:image/png;base64,AA==' } } : { result: null })
  }), [])
  return (
    <div className={scheme === 'dark' ? 'dark' : undefined}>
      <div className="space-y-3 bg-background p-3 text-foreground" style={{ width }}>
        <PortableMessage
          message={message}
          scheme={scheme}
          pendingPermission={null}
          mentionArtwork={{ 'miniapp:board': BOARD_ICON }}
          promptKeywords={HARNESS_CAPABILITIES.claude.promptKeywords}
        />
        <p className="font-mono text-2xs text-muted-foreground" data-testid="native-request">{lastRequest}</p>
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/Portable user message/Bubble',
  component: PhoneBubble,
  parameters: { layout: 'padded' },
  args: { message: userBubbleMessage() },
} satisfies Meta<typeof PhoneBubble>

export default meta
type Story = StoryObj<typeof meta>

/** Every chip the desktop draws: mentions of each kind, keywords, attachments, a paste, quotes and contexts. */
export const AllChips: Story = {}

/** The same bubble on a dark page. */
export const Dark: Story = { args: { scheme: 'dark' } }

/** A narrow phone: chips wrap with the prose, the icon never strands at a line end. */
export const Narrow: Story = { args: { width: 300 } }

/** A goal shows its objective under a Goal label; only `ultrathink` applied after `/goal`. */
export const Goal: Story = { args: { message: userBubbleGoalMessage() } }

/** A message from before pastes were marked: its long run still shows as a paste chip. */
export const LegacyPaste: Story = { args: { message: userBubbleLegacyPasteMessage() } }

/** Plain text only: no chips, nothing to tap. */
export const PlainText: Story = {
  args: { message: userBubbleMessage({ content: [{ type: 'text', text: 'Why does the login loop after a token refresh?' }], attachments: [], userSelections: [], contexts: [] }) },
}
