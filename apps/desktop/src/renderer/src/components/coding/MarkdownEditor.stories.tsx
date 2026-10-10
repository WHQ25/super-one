import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarkdownEditor } from './MarkdownEditor'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

mockIpc('app', 'getMediaServerPort', async () => 6006)
mockIpc('app', 'saveFile', async () => ({ ok: true }))

const CONTENT = `# Markdown preview

The font grows gently as this preview pane gets wider. Narrow panes keep their compact typography, and wide panes stop growing at a comfortable reading size.

中文内容也会随预览面板的宽度调整字号，拖动分栏时无需重新打开文件。

## Reading and editing

- Resize the preview to compare paragraph and heading sizes.
- Click a paragraph to edit without losing your place.
- **Bold**, *italic*, and \`inline code\` keep their relative proportions.

### Code example

\`\`\`ts
const preview = { minFontSize: 14, maxFontSize: 18 }
\`\`\`

| Pane width | Body size |
| --- | --- |
| Up to 640px | 14px |
| 960px | 16px |
| 1280px and above | 18px |

> The pane width controls the font size, including when several panes share a large window.
`

type StoryArgs = ComponentProps<typeof MarkdownEditor> & { width: number }

function Preview({ width, ...props }: StoryArgs) {
  return (
    <div style={{ width, maxWidth: '100%', height: 640 }} className="border border-border bg-background">
      <MarkdownEditor {...props} />
    </div>
  )
}

function ResizablePreview(args: StoryArgs) {
  const [width, setWidth] = useState(args.width)
  return (
    <div className="space-y-3 p-4">
      <label className="flex items-center gap-3 text-sm">
        Preview width: {width}px
        <input
          aria-label="Preview width"
          type="range"
          min={320}
          max={1600}
          step={10}
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
        />
      </label>
      <Preview {...args} width={width} />
    </div>
  )
}

const meta = {
  title: 'Coding/MarkdownEditor',
  component: MarkdownEditor,
  parameters: { layout: 'fullscreen' },
  args: {
    content: CONTENT,
    filePath: '/storybook/markdown-preview.md',
    onDirtyChange: () => {},
    onContentChange: () => {},
    width: 960,
  },
  argTypes: { width: { control: { type: 'range', min: 320, max: 1600, step: 10 } } },
  render: (args) => <Preview {...args} />,
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Narrow: Story = { args: { width: 390 } }
export const Wide: Story = { args: { width: 1280 } }
export const Resizable: Story = { render: (args) => <ResizablePreview {...args} /> }
export const Empty: Story = { args: { content: '' } }
export const LongContent: Story = { args: { content: Array.from({ length: 12 }, () => CONTENT).join('\n\n') } }
