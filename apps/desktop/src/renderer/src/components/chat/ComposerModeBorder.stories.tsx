import type { Meta, StoryObj } from '@storybook/react-vite'
import { ComposerModeBorder, type ComposerMode } from './ComposerModeBorder'

/** The composer box as ChatInput draws it with a mode border: its own stacking context, border hidden, the ring in its place. */
function Composer({ mode, draft, width = 640 }: { mode: ComposerMode; draft: string; width?: number }) {
  return (
    <div className="relative z-10 rounded-xl border border-transparent px-3 py-2" style={{ width, maxWidth: '100%' }}>
      <ComposerModeBorder mode={mode} />
      <div className="min-h-9 whitespace-pre-wrap text-sm leading-6 text-foreground">
        {draft || <span className="text-muted-foreground">Ask anything…</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-md px-1.5 py-1">+</span>
        <span className="rounded-md px-1.5 py-1">Opus 5.5 · Extra High</span>
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/Composer/ComposerModeBorder',
  component: Composer,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

/** The session's Ultracode toggle is on: the next turn runs as a dynamic workflow. */
export const Ultracode: Story = { args: { mode: 'ultracode', draft: '' } }

/** The draft asks for deeper reasoning on this turn: the rainbow turns, without sparkles. */
export const Ultrathink: Story = { args: { mode: 'ultrathink', draft: 'Find the race in the session store, ultrathink' } }

/** A Codex session with Ultra effort selected: the same mode in Codex's Ultra colours. No keyword is involved. */
export const CodexUltra: Story = { args: { mode: 'codex-ultra', draft: '' } }

/** A taller draft: the ring and its sparkles follow the box. */
export const LongDraft: Story = {
  args: {
    mode: 'ultracode',
    draft: '把 session 存储层迁到 SQLite，并补齐迁移测试。\n顺便检查冷启动时会不会丢数据，\n最后把结论写进 docs/features/sessions.md。ultracode',
  },
}

/** A narrow pane. */
export const Narrow: Story = { args: { mode: 'ultrathink', draft: 'ultrathink', width: 320 } }
