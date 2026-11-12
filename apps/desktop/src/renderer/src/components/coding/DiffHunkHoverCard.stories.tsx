import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CodeCommentNoteHost } from '@/components/chat/CodeCommentNoteHost'
import { DiffHunkHoverCard } from './DiffHunkHoverCard'
import type { EditorDiffChange } from './editor-diff'

const modified: EditorDiffChange = {
  id: 'mod:10:10',
  kind: 'modified',
  oldStartLine: 10,
  oldLines: ["  const host = options.host ?? '127.0.0.1'"],
  newStartLine: 10,
  newEndLine: 10,
  newLines: ["  const host = options.host ?? '0.0.0.0'"],
  anchorLine: 10,
}

function HoverCardPreview({ change }: { change: EditorDiffChange }) {
  return (
    <div className="h-72">
      <CodeCommentNoteHost />
      <DiffHunkHoverCard
        change={change}
        anchorRect={{ top: 24, bottom: 48, left: 16, right: 48 }}
        language="typescript"
        filePath="src/server.ts"
        fileRoot={null}
        onRevert={() => {}}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />
    </div>
  )
}

const meta = {
  title: 'Coding/DiffHunkHoverCard',
  component: HoverCardPreview,
  parameters: { layout: 'padded' },
  args: { change: modified },
} satisfies Meta<typeof HoverCardPreview>

export default meta
type Story = StoryObj<typeof meta>

/** Revert is an icon with a tooltip. Add comment opens the shared sticky note on the diff quote. */
export const Modified: Story = {
  play: async () => {
    const body = within(document.body)
    const revert = await body.findByTestId('diff-hunk-revert')
    expect(revert).toHaveAccessibleName('Revert Change')
    expect(revert.textContent?.trim() ?? '').toBe('')
    await userEvent.click(await body.findByTestId('diff-hunk-add-comment'))
    await waitFor(() => expect(document.body.querySelector('textarea[data-plan-draft]')).not.toBeNull())
  },
}

export const Deleted: Story = {
  args: {
    change: {
      id: 'del:4:3:below',
      kind: 'deleted',
      oldStartLine: 4,
      oldLines: ['  const legacyTimeout = 5000'],
      newStartLine: 4,
      newEndLine: 3,
      newLines: [],
      anchorLine: 3,
      deletePosition: 'below',
    },
  },
}
