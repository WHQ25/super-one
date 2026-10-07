import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import type { HarnessId } from '@superone/shared/harness/harness-id'
import { PromptKeywordDecoration, syncPromptKeywords } from './prompt-keyword-decoration'

/** The composer's editor reduced to plain text plus the keyword decoration, as ChatInput wires it. */
function Composer({ harness, text, width = 560 }: { harness: HarnessId; text: string; width?: number }) {
  const keywords = HARNESS_CAPABILITIES[harness].promptKeywords
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, codeBlock: false, horizontalRule: false, listItem: false, code: false, bold: false, italic: false, strike: false, dropcursor: false }),
      PromptKeywordDecoration.configure({ keywords }),
    ],
    editorProps: { attributes: { class: 'w-full min-h-9 text-sm leading-6 outline-none text-foreground', 'data-chat-input-editor': 'true' } },
    content: text.split('\n').map((line) => `<p>${line}</p>`).join(''),
  })
  useEffect(() => { syncPromptKeywords(editor, keywords) }, [editor, keywords])
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2" style={{ width, maxWidth: '100%' }}>
      <EditorContent editor={editor} />
    </div>
  )
}

const meta = {
  title: 'Chat/Composer/PromptKeywords',
  component: Composer,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

/** Claude acts on `ultrathink`: each letter takes Claude Code's rainbow colour and a shimmer sweeps across. */
export const Ultrathink: Story = { args: { harness: 'claude', text: 'ultrathink 为什么这个迁移在冷启动时会丢数据？' } }

/** `ultracode` in Claude Code's purple, with the same shimmer; both keywords can share a draft. */
export const Ultracode: Story = {
  args: { harness: 'claude', text: 'ultracode 把 session 存储层迁到 SQLite，并补齐迁移测试\n顺便 ultrathink 一下冷启动时 Ultracode 会不会丢数据' },
}

/** Claude Code only reads `ultracode` as a request: quoted, bracketed, path, flag, file and question mentions stay plain. */
export const UltracodeMentionedOnly: Story = {
  args: { harness: 'claude', text: 'what is ultracode? see "ultracode", `ultracode`, docs/ultracode, --ultracode and ultracode.md' },
}

/** A slash command never triggers `ultracode`, but `ultrathink` still applies to it. */
export const SlashCommand: Story = { args: { harness: 'claude', text: '/review ultracode ultrathink' } }

/** Every occurrence is painted, in any case and next to CJK text; `ultrathinking` is not the keyword. */
export const SeveralOccurrences: Story = {
  args: { harness: 'claude', text: 'UltraThink about the cache, then ultrathink再检查一遍。\nultrathinking is just a word.' },
}

/** A long draft wraps without breaking the per-letter colours. */
export const LongDraft: Story = {
  args: {
    harness: 'claude',
    width: 360,
    text: 'Please ultrathink through the session restore path: the renderer revives status from stream events, main merges persisted state, and the mobile host replays the backlog. Where can a stale status win?',
  },
}

/** Codex has no prompt keywords, so the same words stay plain text. */
export const HarnessWithoutKeywords: Story = { args: { harness: 'codex', text: 'ultracode ultrathink 为什么这个迁移在冷启动时会丢数据？' } }
