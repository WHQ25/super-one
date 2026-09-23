import type { Meta, StoryObj } from '@storybook/react-vite'
import { wrapGitMention } from '@superone/shared/git-mention-tags'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { PortableUserText } from './PortableUserText'

/**
 * Mention chips inside user text. Labels show in full and wrap with the
 * surrounding prose; the icon never strands alone at a line end.
 */
function UserText({ text, width }: { text: string; width: number }) {
  return (
    <div className="rounded-lg border border-border p-3 text-sm leading-6" style={{ width }}>
      <PortableUserText text={text} />
    </div>
  )
}

const LONG_ISSUE = wrapGitMention(
  'issue:github:65',
  '#65 Collab link: a handoff-received session can never be linked or messaged by other sessions ("already bound as")',
)
const LONG_FILE = wrapPathRefMention(
  'file',
  '/repo/packages/chat-view/src/presenters/an-unusually-long-presenter-file-name-for-the-collab-block.tsx',
  'an-unusually-long-presenter-file-name-for-the-collab-block.tsx',
)

const meta = {
  title: 'Chat/Portable user message/Mention chips',
  component: UserText,
  args: { width: 390, text: `Fix ${LONG_ISSUE} first, then check ${LONG_FILE} for the same bug.` },
} satisfies Meta<typeof UserText>

export default meta
type Story = StoryObj<typeof meta>

export const LongLabels: Story = {
  name: 'Long labels · full text, wrap with the prose',
}

export const ChipOnly: Story = {
  name: 'Chip only · wraps inside the bubble',
  args: { text: LONG_ISSUE },
}

export const LongAgent: Story = {
  name: 'Long agent · pill wraps too',
  args: { text: `${wrapPathRefMention('agent', 'an-agent-with-a-remarkably-long-name-for-testing-truncation', 'an-agent-with-a-remarkably-long-name-for-testing-truncation')} take this` },
}

export const ShortChips: Story = {
  name: 'Short chips · baseline aligned',
  args: {
    text: `Compare ${wrapPathRefMention('file', '/repo/a.ts', 'a.ts')} with ${wrapGitMention('issue:github:7', '#7 Crash')} gjpq.`,
  },
}

export const Narrow: Story = {
  name: 'Narrow · 240px',
  args: { width: 240 },
}
