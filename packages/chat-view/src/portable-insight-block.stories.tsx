import type { Meta, StoryObj } from '@storybook/react-vite'
import { PortableInsight } from './PortableMarkdown'

/**
 * The insight callout as the phone renders it.
 *
 * Two routes reach the same card and only one of them is exercised by the markdown
 * stories: desktop chat keeps the `★ … ───` markers inside the turn's text and splits
 * them at render time, while the remote projection splits them in the main process and
 * ships a typed `insight` block. These stories drive the block route, which is the one
 * that had no renderer at all.
 */
const meta = {
  title: 'Chat/SuperOne/Insight block',
  component: PortableInsight,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[390px]"><Story /></div>],
  args: {
    title: 'Insight',
    content: [
      '- The reducer kept the block; the renderer had no `case` for it.',
      '- `ContentBlock` never declared `insight`, so a cast hid it from typecheck.',
    ].join('\n'),
    isStreaming: false,
    scheme: 'dark' as const,
  },
} satisfies Meta<typeof PortableInsight>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Default · bulleted body',
}

export const Light: Story = {
  name: 'Light scheme',
  args: { scheme: 'light' },
}

export const Streaming: Story = {
  name: 'Streaming · body still arriving',
  args: { isStreaming: true, content: '- The reducer kept the block; the render' },
}

export const WithCode: Story = {
  name: 'With code · fenced block inside the callout',
  args: {
    content: [
      'The cast that hid it from the type checker:',
      '',
      '```ts',
      "{ type: 'insight', title, content } as unknown as ContentBlock",
      '```',
    ].join('\n'),
  },
}

export const LongTitle: Story = {
  name: 'Long title · wraps in a phone column',
  args: { title: 'Why the remote projection splits insight blocks in the main process' },
}

export const SingleLine: Story = {
  name: 'Single line · shortest body',
  args: { content: 'Both surfaces now mount the same card.' },
}

export const LongBody: Story = {
  name: 'Long body · several paragraphs',
  args: {
    content: [
      'Desktop keeps the markers in the text and splits at render time.',
      '',
      'The phone receives a typed block instead, because the desktop main process ran',
      '`splitTextIntoBlocks` before the turn ever left the machine.',
      '',
      '- Same card either way',
      '- Different route to it',
    ].join('\n'),
  },
}
