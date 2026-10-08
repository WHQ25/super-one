import type { Meta, StoryObj } from '@storybook/react-vite'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import type { HarnessId } from '@superone/shared/harness/harness-id'
import { PortableUserText } from './portable-user-text.fixture'

/** A sent bubble's text in the mobile chat document, painted for the session's harness. */
function UserText({ harness, text, width }: { harness: HarnessId; text: string; width: number }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm leading-6" style={{ width }}>
      <PortableUserText text={text} promptKeywords={HARNESS_CAPABILITIES[harness].promptKeywords} />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable user message/Prompt keywords',
  component: UserText,
  args: { harness: 'claude', width: 390, text: 'ultrathink 为什么这个迁移在冷启动时会丢数据？' },
} satisfies Meta<typeof UserText>

export default meta
type Story = StoryObj<typeof meta>

/** `ultrathink` in Claude Code's rainbow, with the composer's shimmer. */
export const Ultrathink: Story = {}

/** `ultracode` in its purple; both keywords can share a message, next to a mention chip. */
export const Ultracode: Story = {
  args: { text: `ultracode 把 session 存储层迁到 SQLite\n顺便 ultrathink 一下 ${wrapPathRefMention('file', '/repo/src/session.ts', 'session.ts')} 的冷启动` },
}

/** Only what the harness acted on is painted: quoted, path, flag and question mentions stay plain. */
export const MentionedOnly: Story = {
  args: { text: 'what is ultracode? see "ultracode", docs/ultracode, --ultracode and ultracode.md' },
}

/** A long message on a narrow phone wraps without breaking the letters. */
export const Narrow: Story = {
  args: {
    width: 240,
    text: 'Please ultrathink through the session restore path: the renderer revives status from stream events. Where can a stale status win?',
  },
}

/** A harness without prompt keywords shows the words as plain text. */
export const HarnessWithoutKeywords: Story = { args: { harness: 'codex', text: 'ultracode ultrathink 为什么这个迁移在冷启动时会丢数据？' } }
