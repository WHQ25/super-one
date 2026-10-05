import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { AutoResizeTextarea } from './auto-resize-textarea'

function Editor(args: ComponentProps<typeof AutoResizeTextarea>) {
  const [value, setValue] = useState(args.value)
  const [submitted, setSubmitted] = useState('')
  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <AutoResizeTextarea {...args} value={value} onValueChange={setValue} onSubmit={() => setSubmitted(value)} />
      {submitted && <output className="whitespace-pre-wrap text-xs text-muted-foreground">{submitted}</output>}
    </div>
  )
}

const meta: Meta<typeof AutoResizeTextarea> = {
  title: 'UI/Auto Resize Textarea',
  component: AutoResizeTextarea,
  render: (args) => <Editor {...args} />,
  args: { value: '', onValueChange: () => {}, 'aria-label': 'Feedback', placeholder: 'Feedback' },
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const LongContent: Story = { args: { value: 'Please preserve the existing configuration and add error handling.\nExplain how the new settings affect sessions that are already running.\nKeep the existing keyboard shortcuts.' } }
export const ScrollLimit: Story = { args: { value: Array.from({ length: 10 }, (_, i) => `Review item ${i + 1}`).join('\n') } }
export const Narrow: Story = { ...LongContent, decorators: [(Story) => <div style={{ width: 280 }}><Story /></div>] }
export const Invalid: Story = { args: { 'aria-invalid': true, value: 'A rejected answer' } }
export const Disabled: Story = { args: { disabled: true, value: 'Disabled feedback' } }
export const ReadOnly: Story = { args: { readOnly: true, value: 'Read-only feedback\nThe original answer remains visible.' } }

function undoableNewline(shortcut: string): Story {
  return {
    args: { value: 'first last' },
    play: async ({ canvasElement }) => {
      const input = within(canvasElement).getByRole('textbox') as HTMLTextAreaElement
      await userEvent.click(input)
      input.setSelectionRange(5, 6)
      await userEvent.keyboard(shortcut)
      await expect(input).toHaveValue('first\nlast')
      await expect(input.selectionStart).toBe(6)
      // Exercise the browser's undo stack; jsdom cannot implement native edit history.
      await expect(input.ownerDocument.execCommand('undo')).toBe(true)
      await expect(input).toHaveValue('first last')
      await expect(input.ownerDocument.execCommand('redo')).toBe(true)
      await expect(input).toHaveValue('first\nlast')
    },
  }
}

export const UndoShiftEnter: Story = undoableNewline('{Shift>}{Enter}{/Shift}')
export const UndoAltEnter: Story = undoableNewline('{Alt>}{Enter}{/Alt}')
