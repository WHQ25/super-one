import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { PromptSuggestion } from './prompt-suggestion'

/**
 * The ghost is a ProseMirror widget decoration, so these stories mount a real
 * editor with the real extension — a hand-written copy of the widget markup
 * would keep passing after the decoration itself changed shape.
 */
function GhostComposer({
  suggestion,
  content = '',
  width = 560,
}: {
  suggestion: string | null
  content?: string
  width?: number
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        codeBlock: false,
        horizontalRule: false,
        listItem: false,
        code: false,
        bold: false,
        italic: false,
        strike: false,
        dropcursor: false,
      }),
      PromptSuggestion,
    ],
    content,
    editorProps: {
      attributes: {
        class:
          'w-full min-h-9 max-h-30 overflow-y-auto text-sm leading-6 outline-none text-foreground',
      },
    },
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    // Mirrors ChatInput: write the suggestion into extension storage, flag the
    // editor DOM so the placeholder steps aside, then force a decoration redraw.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(editor.storage as any).promptSuggestion.suggestion = suggestion
    editor.view.dom.classList.toggle('has-prompt-suggestion', !!suggestion)
    editor.view.dispatch(editor.state.tr)
  }, [editor, suggestion])

  return (
    <div className="rounded-xl border border-border px-3 py-2" style={{ width }}>
      <EditorContent editor={editor} />
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Opus 5 1M · High</span>
        <span>↑</span>
      </div>
    </div>
  )
}

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

const SHORT = 'Summarize the release notes'
const WRAPPED = '帮我把 lifecycle 规则的检查和方案 D 整理成一段，我带回主线程'
const LONG =
  '帮我把 lifecycle 规则的检查、方案 D 的取舍、以及回归测试的范围整理成一段可以直接贴进 PR 描述的说明，' +
  '顺便标出哪些结论还需要产品确认，哪些是我可以自己拍板的，最后给我一个下一步的清单。'

const meta: Meta = {
  title: 'Chat/PromptSuggestion',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  render: () => (
    <div className="space-y-8">
      <Section title="Single line" note="Badge sits right after the text, on the same line.">
        <GhostComposer suggestion={SHORT} />
      </Section>

      <Section
        title="Wrapped"
        note="Regression case: the badge must trail the LAST line, not float against the right edge of the whole block."
      >
        <GhostComposer suggestion={WRAPPED} />
      </Section>

      <Section
        title="Overflowing"
        note="Past the editor's max height the ghost scrolls with the editor; the badge still ends the final line."
      >
        <GhostComposer suggestion={LONG} />
      </Section>

      <Section title="Typing" note="A non-empty document suppresses the ghost entirely.">
        <GhostComposer suggestion={WRAPPED} content="I already started typing" />
      </Section>
    </div>
  ),
}

/** Same suggestion at three widths — the wrap point (and so the badge) moves with it. */
export const WidthSweep: Story = {
  render: () => (
    <div className="space-y-8">
      {[320, 480, 720].map((width) => (
        <Section key={width} title={`${width}px`}>
          <GhostComposer suggestion={WRAPPED} width={width} />
        </Section>
      ))}
    </div>
  ),
}

export const Playground: StoryObj<{ suggestion: string; width: number }> = {
  args: { suggestion: WRAPPED, width: 560 },
  argTypes: {
    suggestion: { control: 'text' },
    width: { control: { type: 'range', min: 240, max: 900, step: 10 } },
  },
  render: (args) => <GhostComposer suggestion={args.suggestion} width={args.width} />,
}
