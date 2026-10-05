import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef } from 'react'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { ChatMessage } from './ChatMessage'

// A file chip's right-click menu asks which MCP Apps open the file: none here.
const storyWindow = window as unknown as { environment?: Record<string, unknown> }
storyWindow.environment = { ...storyWindow.environment, mcpAppFileHandlers: async () => ({ ok: true, value: { handlers: [] } }) }

const ASSISTANT =
  '字段本身就是备注和描述，却都被通用 `string` 编辑器渲染成窄单行框。见 [SettingField](/Users/me/project/src/SettingField.tsx#L104) 和 `renderField()`，'
  + '它们按 `type` 分派，没有看 `multiline`。'

const message = (role: 'user' | 'assistant', text: string): ChatMessageType => ({
  id: `${role}-1`, role, status: 'complete', providerId: role === 'user' ? 'user' : 'claude',
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  content: [{ type: 'text', text }],
})

/**
 * Read-only chat content with inline code, a file chip and bubble mention chips.
 * `select` selects the whole transcript so every chip shows its selected fill.
 */
function Transcript({ select, width = 560 }: { select: boolean; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!select || !ref.current) return
    const range = document.createRange()
    range.selectNodeContents(ref.current)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
  }, [select])
  const user = `看看 ${wrapPathRefMention('file', 'src/SettingField.tsx', 'SettingField.tsx')} 和 ${wrapPathRefMention('directory', 'src/settings/', 'settings')} 里的字段渲染`
  return (
    <div ref={ref} className="@container space-y-3 rounded-xl border border-border/60 bg-background p-3" style={{ width, maxWidth: '100%' }}>
      <ChatMessage message={message('user', user)} sessionStatus="idle" isLastAssistant={false} />
      <ChatMessage message={message('assistant', ASSISTANT)} sessionStatus="idle" isLastAssistant />
    </div>
  )
}

const meta = {
  title: 'Chat/Selection',
  component: Transcript,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Transcript>

export default meta
type Story = StoryObj<typeof meta>

/** Inline code, file chips and mention chips fill to the line box, so the highlight runs unbroken. */
export const AcrossChips: Story = { args: { select: true } }

export const AcrossChipsNarrow: Story = { args: { select: true, width: 320 } }

/** Unselected: chips keep their normal look. */
export const Unselected: Story = { args: { select: false } }

const MARKDOWN = [
  '## Root cause',
  '',
  'Position is lost at **two** points, see [the plan](https://example.com/plan) and `insertContent`:',
  '',
  '1. **When copying**: images go last.',
  '2. **When pasting**: text goes first.',
  '   - nested *detail* with `code`',
  '   - second detail',
  '3. Third step',
  '',
  '> A quote with a ~~mistake~~ fix.',
  '',
  '```ts',
  'const a = 1',
  'console.log(a)',
  '```',
  '',
  '| Side | Fix |',
  '| --- | :-: |',
  '| Copy | order \\| blocks |',
  '| Paste | one insert |',
  '',
  'Inline math $a^2 + b^2$ and display:',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
  '```mermaid',
  'graph LR',
  '  Copy --> Paste',
  '```',
  '',
  '- [x] done task',
  '- [ ] open task',
  '',
  '---',
  '',
  'Last paragraph.',
].join('\n')

function MarkdownReply({ select }: { select: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!select || !ref.current) return
    const range = document.createRange()
    range.selectNodeContents(ref.current)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
  }, [select])
  return (
    <div ref={ref} className="@container rounded-xl border border-border/60 bg-background p-3" style={{ width: 640, maxWidth: '100%' }}>
      <ChatMessage message={message('assistant', MARKDOWN)} sessionStatus="idle" isLastAssistant />
    </div>
  )
}

/** A Markdown reply: list markers fill with the selection, and copying yields Markdown. */
export const MarkdownSelected: Story = { args: { select: true }, render: (args) => <MarkdownReply select={args.select} /> }
