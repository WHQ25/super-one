import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { RecappingIndicator, TurnMetaIndicator } from './presenters/ChatMessageIndicators'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'

void initializeChatViewI18n('en')

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    status: 'complete',
    providerId: 'acp',
    createdAt: new Date(Date.now() - 45_000).toISOString(),
    content: [
      {
        type: 'text',
        text: 'Grok ACP streams the reply body. Tool arguments usually arrive as one packet, so the card appears all at once.',
      } satisfies ContentBlock,
    ],
    metadata: {
      durationMs: 45_000,
      consumedTokens: { input: 18_400, output: 2_600 },
      turnSummary: 'Tool args are not streamed: Grok sends the whole packet',
    },
    ...overrides,
  }
}

function user(text: string, id = 'user-1'): ChatMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    providerId: 'user',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    content: [{ type: 'text', text }],
  }
}

function Phone({ children, width = 390 }: { children: ReactNode; width?: number }) {
  return <div className="space-y-2 p-3" style={{ width }}>{children}</div>
}

const meta = {
  title: 'Chat/Portable turn meta',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Phone chat-view chrome for Grok last-turn summary (above the footer) and session recap. Same “Summary:” / “Recap:” prefix as desktop.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj

export const WithoutSummary: Story = {
  name: 'Without summary',
  render: () => (
    <Phone>
      <PortableMessage
        message={assistant({
          metadata: { durationMs: 45_000, consumedTokens: { input: 18_400, output: 2_600 } },
        })}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </Phone>
  ),
}

export const TurnSummary: Story = {
  name: 'Turn summary above footer',
  render: () => (
    <Phone>
      <PortableMessage
        message={user('Does Grok ACP stream tool calls?')}
        scheme="dark"
        pendingPermission={null}
        sessionStreaming={false}
      />
      <PortableMessage
        message={assistant()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </Phone>
  ),
}

export const AutoRecap: Story = {
  name: 'Session recap (auto)',
  render: () => (
    <Phone>
      <PortableMessage
        message={assistant()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
      <TurnMetaIndicator
        meta={{
          kind: 'recap',
          text: 'While you were away: aligned Grok ACP streaming, and moved the turn summary above the footer.',
          auto: true,
        }}
      />
    </Phone>
  ),
}

export const ManualRecap: Story = {
  name: 'Session recap (manual)',
  render: () => (
    <Phone>
      <TurnMetaIndicator
        meta={{
          kind: 'recap',
          text: 'This session covered ACP streaming, atomic tool arguments, and the Summary / Recap chrome.',
          auto: false,
        }}
      />
    </Phone>
  ),
}

export const GeneratingRecap: Story = {
  name: 'Generating recap',
  render: () => (
    <Phone>
      <PortableMessage
        message={assistant()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
      <RecappingIndicator />
    </Phone>
  ),
}

export const FullStack: Story = {
  name: 'Full turn stack',
  render: () => (
    <Phone>
      <PortableMessage
        message={user('The Grok turn summary placement looks off')}
        scheme="dark"
        pendingPermission={null}
        sessionStreaming={false}
      />
      <PortableMessage
        message={assistant()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
      <TurnMetaIndicator
        meta={{
          kind: 'recap',
          text: 'Back: last turn was moving the summary; recap stays a standalone line at the bottom of the thread.',
          auto: true,
        }}
      />
    </Phone>
  ),
}

export const LongRecap: Story = {
  name: 'Long recap',
  render: () => (
    <Phone>
      <TurnMetaIndicator
        meta={{
          kind: 'recap',
          text: 'While you were away the session finished the ACP streaming audit, confirmed tool arguments arrive as one packet rather than deltas, moved last-turn summary onto the assistant footer with a Summary: prefix, and kept /recap as a Recap: line of its own so the two never share a row.',
          auto: true,
        }}
      />
    </Phone>
  ),
}

export const Narrow: Story = {
  name: 'Narrow layout',
  render: () => (
    <Phone width={320}>
      <PortableMessage
        message={assistant({
          metadata: {
            durationMs: 45_000,
            consumedTokens: { input: 18_400, output: 2_600 },
            turnSummary: 'Investigate why the session search field sits a full status-bar height below the notch',
          },
        })}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
      <TurnMetaIndicator
        meta={{
          kind: 'recap',
          text: 'Narrow width: Summary: and Recap: prefixes must wrap with the body, not clip.',
          auto: false,
        }}
      />
    </Phone>
  ),
}

/**
 * Footer row alignment. Every icon (copy, clock, spinner, warning, token
 * arrows) is 12px inside a 16px text line; each story exists to show them
 * sitting on the text's centre rather than 2px above it.
 */
function footerTurn(overrides: Partial<ChatMessage> = {}) {
  return assistant({ metadata: { durationMs: 45_000, consumedTokens: { input: 18_400, output: 2_600 } }, ...overrides })
}

export const FooterSending: Story = {
  name: 'Footer · sending',
  render: () => (
    <Phone>
      <PortableMessage
        message={footerTurn({ status: 'streaming', createdAt: new Date().toISOString(), metadata: {} })}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming
      />
    </Phone>
  ),
}

export const FooterLiveClock: Story = {
  name: 'Footer · live clock',
  render: () => (
    <Phone>
      <PortableMessage
        message={footerTurn({ status: 'streaming', metadata: {} })}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming
      />
    </Phone>
  ),
}

export const FooterSettled: Story = {
  name: 'Footer · settled with copy',
  render: () => (
    <Phone>
      <PortableMessage
        message={footerTurn()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </Phone>
  ),
}

export const FooterFailed: Story = {
  name: 'Footer · failed (expandable badge)',
  render: () => (
    <Phone>
      <PortableMessage
        message={footerTurn({
          status: 'error',
          metadata: { durationMs: 45_000, errorInfo: { raw: 'Overloaded', httpStatus: 529 } },
        })}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </Phone>
  ),
}

export const FooterStopped: Story = {
  name: 'Footer · stopped by terminal reason',
  render: () => (
    <Phone>
      <PortableMessage
        message={footerTurn({
          metadata: { durationMs: 45_000, consumedTokens: { input: 18_400, output: 2_600 }, terminalReason: 'max_tokens' },
        })}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </Phone>
  ),
}
