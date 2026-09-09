import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { PromptSuggestionChips } from './PromptSuggestionChips'

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
      {children}
    </section>
  )
}

/**
 * Stands in for the composer the chips sit above. The ghost is drawn flat rather than
 * through the real ProseMirror decoration — this file is about the chip row, and the
 * decoration itself has its own stories under Chat/PromptSuggestion.
 */
function Composer({ text, ghost, width = 560 }: { text?: string; ghost?: string; width?: number }) {
  return (
    <div
      className="mx-3 mb-1 flex min-h-9 items-center rounded-xl border border-border px-3 py-2 text-sm"
      style={{ width }}
    >
      {text ? (
        <span className="text-foreground">{text}</span>
      ) : ghost ? (
        <span className="flex items-center gap-1.5 text-muted-foreground/60">
          {ghost}
          <kbd className="rounded border border-border px-1 text-[10px]">Tab</kbd>
        </span>
      ) : (
        <span className="text-muted-foreground/60">Ask anything…</span>
      )}
    </div>
  )
}

const GHOST = '加上，在 Projects 分组头显示待处理计数'
const ALTERNATES = ['先解释一下这个 diff', '跑一遍受影响的测试']

const meta: Meta<typeof PromptSuggestionChips> = {
  title: 'Chat/PromptSuggestionChips',
  component: PromptSuggestionChips,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof PromptSuggestionChips>

export const Gallery: Story = {
  render: () => (
    <div className="space-y-8">
      <Section
        title="Alternatives beside the ghost"
        note="The shipping multi-option case (xAI/Grok). The first suggestion is in the input as ghost text; only the rest get a chip, so nothing is duplicated."
      >
        <div style={{ width: 560 }}>
          <PromptSuggestionChips suggestions={ALTERNATES} onSelect={() => {}} />
          <Composer ghost={GHOST} />
        </div>
      </Section>

      <Section
        title="Empty"
        note="A single-suggestion harness (Claude) leaves nothing for this row — its one suggestion is the ghost. The row renders no wrapper, so it costs no vertical space."
      >
        <div style={{ width: 560 }}>
          <PromptSuggestionChips suggestions={[]} onSelect={() => {}} />
          <Composer ghost={GHOST} />
        </div>
      </Section>

      <Section title="Long content" note="Each chip truncates rather than pushing the row wide.">
        <div style={{ width: 560 }}>
          <PromptSuggestionChips
            suggestions={[
              '帮我把 lifecycle 规则的检查、方案 D 的取舍、以及回归测试的范围整理成一段可以直接贴进 PR 描述的说明',
              '短的那条',
            ]}
            onSelect={() => {}}
          />
          <Composer ghost={GHOST} />
        </div>
      </Section>

      <Section title="Narrow layout" note="Chips wrap onto further rows at a side-chat width.">
        <div style={{ width: 300 }}>
          <PromptSuggestionChips suggestions={ALTERNATES} onSelect={() => {}} />
          <Composer ghost={GHOST} width={300} />
        </div>
      </Section>
    </div>
  ),
}

/** Clicking a chip writes it into the composer, which drops the ghost behind it. */
export const Selecting: Story = {
  render: () => {
    const [text, setText] = useState('')
    return (
      <div style={{ width: 560 }}>
        <PromptSuggestionChips suggestions={ALTERNATES} onSelect={setText} />
        <Composer text={text} ghost={GHOST} />
      </div>
    )
  },
}
