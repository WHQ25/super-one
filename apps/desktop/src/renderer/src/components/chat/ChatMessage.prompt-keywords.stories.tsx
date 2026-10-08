import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/harness/harness-id'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ChatMessage } from './ChatMessage'

function seed(harness: HarnessId) {
  useChatStore.setState({
    activeProject: '/storybook/prompt-keywords',
    projectSessions: {
      '/storybook/prompt-keywords': {
        ...createDefaultProjectState(),
        _activeSessionId: 'story-session',
        _sessions: { 'story-session': { ...createDefaultPerSessionState(), sessionProvider: harness } },
      },
    },
  })
}

function SentBubble({ harness, text, width = 560 }: { harness: HarnessId; text: string; width?: number }): ReactNode {
  useEffect(() => { seed(harness) }, [harness])
  const message: ChatMessageType = {
    id: 'user-1',
    role: 'user',
    status: 'complete',
    providerId: 'user',
    createdAt: new Date().toISOString(),
    content: [{ type: 'text', text }],
  }
  return (
    <div className="@container mx-auto" style={{ width, maxWidth: '100%' }}>
      <ChatMessage key={harness} message={message} sessionStatus="idle" isLastAssistant={false} />
    </div>
  )
}

const meta = {
  title: 'Chat/UserBubble/PromptKeywords',
  component: SentBubble,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SentBubble>

export default meta
type Story = StoryObj<typeof meta>

/** A sent `ultrathink` keeps the composer's rainbow letters, without the shimmer. */
export const Ultrathink: Story = { args: { harness: 'claude', text: 'ultrathink 为什么这个迁移在冷启动时会丢数据？' } }

/** `ultracode` in its purple; both keywords can share a message, next to a mention. */
export const Ultracode: Story = {
  args: { harness: 'claude', text: 'ultracode 把 session 存储层迁到 SQLite\n顺便 ultrathink 一下 @src/main/session/session.ts 的冷启动' },
}

/** Only what the harness acted on is painted: quoted, path, flag and question mentions stay plain. */
export const MentionedOnly: Story = {
  args: { harness: 'claude', text: 'what is ultracode? see "ultracode", docs/ultracode, --ultracode and ultracode.md' },
}

/** A goal shows its objective; `ultracode` after `/goal` did nothing, `ultrathink` still applied. */
export const Goal: Story = { args: { harness: 'claude', text: '/goal ultracode ship the login flow, ultrathink first' } }

/** A long message wraps without breaking the letters. */
export const LongMessage: Story = {
  args: {
    harness: 'claude',
    width: 360,
    text: 'Please ultrathink through the session restore path: the renderer revives status from stream events, main merges persisted state, and the mobile host replays the backlog. Where can a stale status win?',
  },
}

/** A harness without prompt keywords shows the words as plain text. */
export const HarnessWithoutKeywords: Story = { args: { harness: 'codex', text: 'ultracode ultrathink 为什么这个迁移在冷启动时会丢数据？' } }
