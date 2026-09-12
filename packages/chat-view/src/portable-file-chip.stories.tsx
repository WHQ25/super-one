import type { Meta, StoryObj } from '@storybook/react-vite'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableTurnContext } from './portable-turn-context'

/**
 * Project file citations as the phone renders them inside markdown prose.
 *
 * The chip's icon comes from the PATH's extension, never from the link label, so a
 * prose caption cannot downgrade it to the generic document glyph — that downgrade
 * is the bug these stories exist to catch.
 */
const meta = {
  title: 'Chat/SuperOne/File chip',
  component: PortableMarkdown,
  parameters: { layout: 'padded' },
  decorators: [(Story, context) => (
    <PortableTurnContext.Provider
      value={{
        scheme: context.globals.theme === 'light' ? 'light' : 'dark',
        pendingPermission: null,
        mcpIcons: {},
        projectPath: '/Users/me/proj',
      }}
    >
      <div className="w-[390px] text-sm"><Story /></div>
    </PortableTurnContext.Provider>
  )],
  args: {
    text: 'See [ToolRow.tsx](src/components/ToolRow.tsx:42) for the presenter.',
    isStreaming: false,
    scheme: 'dark' as const,
  },
} satisfies Meta<typeof PortableMarkdown>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Default · file with line number',
}

export const Light: Story = {
  name: 'Light scheme',
  args: { scheme: 'light' },
}

export const LineRange: Story = {
  name: 'Line range · #L12-20',
  args: { text: 'The reducer lives in [chat-core.ts](packages/chat-core/src/index.ts:12-20).' },
}

export const ProseLabel: Story = {
  name: 'Prose label · icon still follows the path extension',
  args: { text: 'Fixed in [the power settings UI](src/settings/PowerSettings.tsx).' },
}

export const MixedTypes: Story = {
  name: 'Mixed types · one chip per extension',
  args: {
    text: [
      '- [package.json](package.json)',
      '- [README.md](README.md)',
      '- [main.py](scripts/main.py)',
      '- [theme.css](packages/ui/src/styles/theme.css)',
      '- [notes.txt](docs/notes.txt)',
      '- [Makefile](Makefile)',
    ].join('\n'),
  },
}

/**
 * A chip wider than the column must clamp to it — truncating the name and keeping
 * the line suffix — instead of stretching the whole chat page sideways.
 */
export const LongName: Story = {
  name: 'Long name · truncates within a phone column',
  args: {
    text: [
      'See [a-very-long-component-file-name-that-keeps-going.tsx](src/components/a-very-long-component-file-name-that-keeps-going.tsx:1) here.',
      '',
      '顺带一提 [docs/temp/research/computer-use-comparison/09-p2-macos-mvp.md](docs/temp/research/computer-use-comparison/09-p2-macos-mvp.md:90) 还写着旧目录名。',
    ].join('\n'),
  },
}
