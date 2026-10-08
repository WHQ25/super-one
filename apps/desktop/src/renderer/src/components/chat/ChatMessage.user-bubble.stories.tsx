import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { userBubbleGoalMessage, userBubbleLegacyPasteMessage, userBubbleMessage } from '@superone/chat-view/fixtures/user-bubble'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ChatMessage } from './ChatMessage'

/**
 * The desktop's user bubble, drawn by the shared presenter with the desktop's
 * ports: hover cards, the file menu and drag, the image viewer. The phone's
 * story (`Chat/Portable user message/Bubble`) draws the same messages.
 */
function DesktopBubble({ message, width = 640 }: { message: ChatMessageType; width?: number }) {
  useEffect(() => {
    useChatStore.setState({
      activeProject: '/storybook/user-bubble',
      projectSessions: {
        '/storybook/user-bubble': {
          ...createDefaultProjectState(),
          _activeSessionId: 'story-session',
          _sessions: { 'story-session': { ...createDefaultPerSessionState(), sessionProvider: 'claude' } },
        },
      },
    })
  }, [])
  return (
    <div className="@container mx-auto" style={{ width, maxWidth: '100%' }}>
      <ChatMessage message={message} sessionStatus="idle" isLastAssistant={false} />
    </div>
  )
}

const meta = {
  title: 'Chat/UserBubble/Chips',
  component: DesktopBubble,
  parameters: { layout: 'padded' },
  args: { message: userBubbleMessage() },
} satisfies Meta<typeof DesktopBubble>

export default meta
type Story = StoryObj<typeof meta>

/** Every chip: mentions of each kind, keywords, attachments, a paste, quotes and contexts. */
export const AllChips: Story = {}

/** A narrow pane: chips wrap with the prose. */
export const Narrow: Story = { args: { width: 320 } }

/** A goal shows its objective under a Goal label; only `ultrathink` applied after `/goal`. */
export const Goal: Story = { args: { message: userBubbleGoalMessage() } }

/** A message from before pastes were marked: its long run still shows as a paste chip. */
export const LegacyPaste: Story = { args: { message: userBubbleLegacyPasteMessage() } }
