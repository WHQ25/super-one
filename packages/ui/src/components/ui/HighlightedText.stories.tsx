import type { Meta, StoryObj } from '@storybook/react-vite'
import { HighlightedText } from './HighlightedText'

const meta: Meta<typeof HighlightedText> = {
  title: 'UI/HighlightedText',
  component: HighlightedText,
  args: {
    text: 'useHarnessTheme',
    indices: [0, 1, 2, 7, 8, 9, 10, 11, 12],
  },
}

export default meta
type Story = StoryObj<typeof HighlightedText>

export const Default: Story = {}

export const BrandHighlight: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => {
    const text = 'PermissionPrompt.tsx'
    const match = 'Prompt'
    const start = text.indexOf(match)
    const indices = Array.from({ length: match.length }, (_, i) => start + i)
    return (
      <div className="bg-background text-foreground min-h-screen space-y-3 p-8">
        <p className="text-muted-foreground text-sm">
          The search-match highlight uses <code>text-primary</code>. Drag the hue dial — the matched
          characters should follow the brand color while the surrounding text stays neutral.
        </p>
        <div className="font-mono text-base">
          <HighlightedText text={text} indices={indices} />
        </div>
      </div>
    )
  },
}
